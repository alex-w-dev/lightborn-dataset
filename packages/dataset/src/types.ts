/**
 * Типы общего ассет-датасета (картинки, аудио + текстовые описания).
 */

/**
 * Картинка ассета (монстр / NPC / иконка / аватар / локация).
 * Каталог отвечает только за картинку; description — промпт генерации.
 */
export interface AssetImage {
  id: string;
  description: string;
}

/** Запись в sfx.json (бинарник в S3 `sfx/{id}/original.ogg`). */
export interface SfxAsset {
  id: string;
  description: string;
}

export type MusicWaveId = "peace" | "battle" | "lobby";

/** Запись в music.json (бинарник в S3 `music/{wave}/{id}/original.ogg`). */
export interface MusicAsset {
  id: string;
  wave: MusicWaveId;
  description: string;
}

/** @see AssetImage — запись в monster-images.json (`m0001`, …) */
export type MonsterImage = AssetImage;

/** @see AssetImage — запись в npc-images.json (`n0001`, …) */
export type NpcImage = AssetImage;

/**
 * Запись в `item-icons.json` (`g*`) / `skill-icons.json` (`s*`).
 * Флаги workflow — только `true` (отсутствие = false).
 */
export interface GameIconImage extends AssetImage {
  /** Локально обновлена, Sync в S3 ещё не сделан. */
  pendingS3Sync?: boolean;
  /** Ещё нужно обновить локально. */
  needLocalUpdate?: boolean;
  /** Доработка: локальная 512 есть, Sync в S3 не сделан. */
  retouchPendingS3Sync?: boolean;
  /** Доработка: ещё нужно обновить локально. */
  retouchNeedLocalUpdate?: boolean;
  /** Доработка: локальная 512 уже есть. */
  retouchUpdatedLocally?: boolean;
  /** Доработка: уже залита в S3. */
  retouchUpdatedInS3?: boolean;
}

/** @see AssetImage — запись в avatar-images.json (`1`, `2`, …) */
export type AvatarImage = AssetImage;

/** Запись в location-images.json (S3 `img/locations/{id}/`). */
export interface LocationImage {
  id: string;
  /** Legacy имя файла; публичный ключ — по `id`. */
  file: string;
  description: string;
}
