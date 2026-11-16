import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
  detectSfxUploadFormat,
  isOggMagic,
  resolveFfmpegPath,
  type SfxUploadFormat,
} from './audio-upload-format';
import {
  readGeneratedJson,
  writeGeneratedJson,
} from '../admin/dataset-files';
import { AssetEmbeddingsService } from '../admin/asset-embeddings.service';
import { DatasetSearchService } from '../admin/dataset-search.service';
import { S3Service } from '../s3/s3.service';
import { MusicCatalogService } from './music-catalog.service';
import {
  MUSIC_WAVES,
  MusicTrackDto,
  MusicWave,
  musicS3Key,
} from './music-catalog.types';

type MusicMetaRow = {
  id: string;
  wave: MusicWave;
  description: string;
};

const execFileAsync = promisify(execFile);

export const MUSIC_MAX_BYTES = 30 * 1024 * 1024;

const AUDIO_EXT_RE = /\.(ogg|oga|wav|mp3|mpeg|mpga)$/i;

/**
 * Multer часто отдаёт originalname в latin1 при UTF-8 именах файлов.
 * Для ASCII это no-op; для кириллицы восстанавливает имя.
 */
export function decodeUploadFilename(name: string): string {
  try {
    const asUtf8 = Buffer.from(name, 'latin1').toString('utf8');
    // Если после decode стало «хуже» (replacement chars) — оставляем как есть
    if (asUtf8.includes('\uFFFD')) return name;
    return asUtf8;
  } catch {
    return name;
  }
}

export function assertMusicId(raw: string): string {
  const id = String(raw ?? '').trim();
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    id.length > 200
  ) {
    throw new BadRequestException(
      `Invalid music id: ${raw}. Use the original file name without path`,
    );
  }
  return id;
}

/**
 * Id трека = исходное имя файла без audio-расширения (как при загрузке).
 * Не lowercasing, не sanitize, без суффиксов. Повторная загрузка → overwrite.
 */
export function buildMusicId(originalName?: string): string {
  const name = decodeUploadFilename(String(originalName ?? '').trim());
  if (!name) {
    throw new BadRequestException('File name is required');
  }
  const baseName = path.basename(name);
  const withoutAudioExt = baseName.replace(AUDIO_EXT_RE, '');
  return assertMusicId(withoutAudioExt || baseName);
}

@Injectable()
export class AdminMusicService {
  constructor(
    private readonly s3: S3Service,
    private readonly catalog: MusicCatalogService,
    private readonly search: DatasetSearchService,
    private readonly embeddings: AssetEmbeddingsService,
  ) {}

  listWave(wave: MusicWave): MusicTrackDto[] {
    return this.catalog.getWaveTracks(wave);
  }

  /** Синхронизирует music.json с S3: добавляет недостающие, удаляет orphans. */
  async syncMetaFromCatalog(): Promise<void> {
    const catalog = await this.catalog.getReadyCatalog();
    const live = new Set<string>();
    for (const wave of MUSIC_WAVES) {
      for (const track of catalog[wave]) {
        live.add(`${wave}\0${track.id}`);
      }
    }
    const prev = await this.readMeta();
    const byKey = new Map(prev.map((r) => [`${r.wave}\0${r.id}`, r]));
    const rows: MusicMetaRow[] = [];
    let changed = false;
    for (const key of live) {
      const existing = byKey.get(key);
      if (existing) {
        rows.push(existing);
      } else {
        const [wave, id] = key.split('\0') as [MusicWave, string];
        rows.push({ id, wave, description: '' });
        changed = true;
      }
    }
    if (prev.length !== rows.length) changed = true;
    if (!changed) return;
    rows.sort(
      (a, b) =>
        a.wave.localeCompare(b.wave) || a.id.localeCompare(b.id, 'en'),
    );
    await writeGeneratedJson('music.json', rows);
    this.search.reindex();
    this.embeddings.scheduleReindex();
  }

  private async readMeta(): Promise<MusicMetaRow[]> {
    try {
      const raw = await readGeneratedJson('music.json');
      if (!Array.isArray(raw)) return [];
      const out: MusicMetaRow[] = [];
      for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const id = String((row as MusicMetaRow).id ?? '').trim();
        const wave = String((row as MusicMetaRow).wave ?? '').trim();
        if (!id || !(MUSIC_WAVES as readonly string[]).includes(wave)) continue;
        out.push({
          id,
          wave: wave as MusicWave,
          description: String((row as MusicMetaRow).description ?? ''),
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  private async upsertMeta(wave: MusicWave, id: string): Promise<void> {
    const rows = await this.readMeta();
    if (rows.some((r) => r.wave === wave && r.id === id)) return;
    rows.push({ id, wave, description: '' });
    rows.sort(
      (a, b) =>
        a.wave.localeCompare(b.wave) || a.id.localeCompare(b.id, 'en'),
    );
    await writeGeneratedJson('music.json', rows);
    this.search.reindex();
    this.embeddings.scheduleReindex();
  }

  private async removeMeta(wave: MusicWave, id: string): Promise<void> {
    const rows = await this.readMeta();
    const next = rows.filter((r) => !(r.wave === wave && r.id === id));
    if (next.length === rows.length) return;
    await writeGeneratedJson('music.json', next);
    this.search.reindex();
    this.embeddings.scheduleReindex();
  }

  async uploadTrack(
    wave: MusicWave,
    buffer: Buffer,
    originalName?: string,
  ): Promise<{
    id: string;
    url: string;
    bytes: number;
    format: SfxUploadFormat;
    converted: boolean;
  }> {
    if (!this.s3.isConfigured()) {
      throw new InternalServerErrorException('S3 is not configured');
    }
    if (!buffer?.length) {
      throw new BadRequestException('File is required');
    }
    if (buffer.length > MUSIC_MAX_BYTES) {
      throw new BadRequestException(
        `File too large (max ${MUSIC_MAX_BYTES} bytes)`,
      );
    }

    const format = detectSfxUploadFormat(originalName, buffer);
    if (!format) {
      throw new BadRequestException(
        'Only .ogg, .wav or .mp3 audio files are allowed',
      );
    }
    if (format === 'ogg' && !isOggMagic(buffer)) {
      throw new BadRequestException(
        'File does not look like OGG (missing OggS header)',
      );
    }

    const id = assertMusicId(buildMusicId(originalName));
    const key = musicS3Key(wave, id);

    let oggBuffer: Buffer;
    let converted = false;
    if (format === 'ogg') {
      oggBuffer = buffer;
    } else {
      oggBuffer = await this.convertToOgg(buffer, format);
      converted = true;
    }

    const uploaded = await this.s3.uploadFile({
      key,
      body: oggBuffer,
      contentType: 'audio/ogg',
    });
    if (!uploaded.url) {
      throw new InternalServerErrorException(
        'S3_PUBLIC_BASE_URL is not configured',
      );
    }

    await this.catalog.refresh();
    await this.upsertMeta(wave, id);

    return {
      id,
      url: uploaded.url,
      bytes: oggBuffer.length,
      format,
      converted,
    };
  }

  async deleteTrack(wave: MusicWave, id: string): Promise<void> {
    if (!this.s3.isConfigured()) {
      throw new InternalServerErrorException('S3 is not configured');
    }
    const safeId = assertMusicId(id);
    const key = musicS3Key(wave, safeId);
    const exists = await this.s3.exists(key);
    if (!exists) {
      throw new NotFoundException(`Music track not found: ${wave}/${safeId}`);
    }
    await this.s3.deleteObject(key);
    await this.catalog.refresh();
    await this.removeMeta(wave, safeId);
  }

  private async convertToOgg(
    buffer: Buffer,
    format: Exclude<SfxUploadFormat, 'ogg'>,
  ): Promise<Buffer> {
    const ffmpeg = resolveFfmpegPath();
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-music-'));
    const srcPath = path.join(tmpRoot, `input.${format}`);
    const outPath = path.join(tmpRoot, 'out.ogg');
    try {
      await fs.writeFile(srcPath, buffer);
      try {
        await execFileAsync(
          ffmpeg,
          ['-y', '-i', srcPath, '-c:a', 'libvorbis', '-q:a', '5', outPath],
          { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        );
      } catch (err) {
        const stderr =
          err && typeof err === 'object' && 'stderr' in err
            ? String((err as { stderr?: Buffer | string }).stderr ?? '')
            : '';
        const message = err instanceof Error ? err.message : String(err);
        if (
          /ENOENT|not found|не найден/i.test(message) ||
          (err as NodeJS.ErrnoException)?.code === 'ENOENT'
        ) {
          throw new InternalServerErrorException(
            'ffmpeg not found. Install ffmpeg or set FFMPEG_BIN',
          );
        }
        throw new BadRequestException(
          `Failed to convert ${format} → ogg: ${stderr.trim() || message}`,
        );
      }

      const out = await fs.readFile(outPath);
      if (!isOggMagic(out)) {
        throw new InternalServerErrorException(
          'ffmpeg produced a non-OGG file',
        );
      }
      return out;
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
