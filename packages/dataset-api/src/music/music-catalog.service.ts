import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { assetCdnCacheVersion } from '@l-fight/dataset';
import { S3Service } from '../s3/s3.service';
import {
  MusicCatalogDto,
  MusicTrackDto,
  MusicWave,
  MUSIC_WAVES,
  emptyMusicCatalog,
  musicIdFromKey,
  musicS3Prefix,
} from './music-catalog.types';

@Injectable()
export class MusicCatalogService implements OnModuleInit {
  private readonly logger = new Logger(MusicCatalogService.name);
  private catalog: MusicCatalogDto = emptyMusicCatalog();
  private refreshPromise: Promise<void> | null = null;

  constructor(private readonly s3: S3Service) {}

  onModuleInit(): void {
    void this.refresh().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Music catalog initial refresh failed: ${message}`);
    });
  }

  getCatalog(): MusicCatalogDto {
    const out = emptyMusicCatalog();
    for (const wave of MUSIC_WAVES) {
      out[wave] = [...this.catalog[wave]];
    }
    return out;
  }

  /**
   * Для HTTP: дождаться уже идущего refresh (старт сервера его не ждёт).
   * Иначе клиент закэширует пустой каталог до перезагрузки.
   */
  async getReadyCatalog(): Promise<MusicCatalogDto> {
    const pending = this.refreshPromise;
    if (pending) {
      await pending.catch(() => undefined);
    }
    return this.getCatalog();
  }

  getWaveTracks(wave: MusicWave): MusicTrackDto[] {
    return [...this.catalog[wave]];
  }

  async refresh(): Promise<MusicCatalogDto> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return this.getCatalog();
    }

    this.refreshPromise = this.refreshInternal();
    try {
      await this.refreshPromise;
      return this.getCatalog();
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshInternal(): Promise<void> {
    if (!this.s3.isConfigured()) {
      this.catalog = emptyMusicCatalog();
      this.logger.warn('S3 not configured — music catalog empty');
      return;
    }

    const next = emptyMusicCatalog();
    for (const wave of MUSIC_WAVES) {
      next[wave] = await this.listWave(wave);
    }
    this.catalog = next;
    this.logger.log(
      `Music catalog: peace=${next.peace.length}, battle=${next.battle.length}, lobby=${next.lobby.length}`,
    );
  }

  private async listWave(wave: MusicWave): Promise<MusicTrackDto[]> {
    const keys = await this.s3.listKeys(musicS3Prefix(wave));
    const tracks: MusicTrackDto[] = [];
    for (const key of keys) {
      const id = musicIdFromKey(wave, key);
      if (!id) continue;
      const baseUrl = this.s3.getPublicUrl(key);
      if (!baseUrl) continue;
      tracks.push({
        id,
        url: `${baseUrl}?v=${assetCdnCacheVersion()}`,
      });
    }
    tracks.sort((a, b) => a.id.localeCompare(b.id));
    return tracks;
  }
}
