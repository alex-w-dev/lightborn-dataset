import {
  musicAssetKey,
  musicAssetPrefix,
  musicIdFromAssetKey,
  type MusicWaveKind,
} from '@l-fight/dataset';

export const MUSIC_WAVES = ['peace', 'battle', 'lobby'] as const;

export type MusicWave = (typeof MUSIC_WAVES)[number];

export type MusicTrackDto = {
  id: string;
  url: string;
};

export type MusicCatalogDto = Record<MusicWave, MusicTrackDto[]>;

export function emptyMusicCatalog(): MusicCatalogDto {
  return { peace: [], battle: [], lobby: [] };
}

export function isMusicWave(value: string): value is MusicWave {
  return (MUSIC_WAVES as readonly string[]).includes(value);
}

export function musicS3Prefix(wave: MusicWave): string {
  return musicAssetPrefix(wave as MusicWaveKind);
}

export function musicS3Key(wave: MusicWave, id: string): string {
  return musicAssetKey(wave as MusicWaveKind, id);
}

/** Извлекает id трека из ключа `music/{wave}/{id}/original.ogg`. */
export function musicIdFromKey(wave: MusicWave, key: string): string | null {
  return musicIdFromAssetKey(wave as MusicWaveKind, key);
}
