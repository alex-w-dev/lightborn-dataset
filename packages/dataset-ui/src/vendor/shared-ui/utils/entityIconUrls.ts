import type { ImgSize } from "@l-fight/dataset";
import { API_URL } from "../config/api";
import { assetUrl } from "../config/game-icons-cdn";

export type MonsterIconVariant = "icon" | "preview" | "original";
export type NpcIconVariant = "icon" | "preview" | "original";

/** Стабильный URL + опциональный bust только когда контент реально сменился (админка). */
function withOptionalCacheBust(url: string, cacheBust?: number): string {
  if (cacheBust === undefined || cacheBust === 0) return url;
  return `${url}?v=${cacheBust}`;
}

function variantToSize(variant: MonsterIconVariant | NpcIconVariant): ImgSize {
  if (variant === "icon") return 64;
  if (variant === "preview") return 512;
  return "original";
}

/** Канонический id картинки монстра (`m0001`) из template id. */
export function defaultMonsterImageId(monsterId: number): string {
  return `m${String(monsterId).padStart(4, "0")}`;
}

/** Канонический id картинки NPC (`n0001`) из template id. */
export function defaultNpcImageId(npcId: number): string {
  return `n${String(npcId).padStart(4, "0")}`;
}

export function resolveMonsterImageId(
  imageIdOrMonsterId: string | number,
): string {
  if (typeof imageIdOrMonsterId === "number") {
    return defaultMonsterImageId(imageIdOrMonsterId);
  }
  const trimmed = String(imageIdOrMonsterId).trim();
  return trimmed || defaultMonsterImageId(0);
}

export function resolveNpcImageId(imageIdOrNpcId: string | number): string {
  if (typeof imageIdOrNpcId === "number") {
    return defaultNpcImageId(imageIdOrNpcId);
  }
  const trimmed = String(imageIdOrNpcId).trim();
  return trimmed || defaultNpcImageId(0);
}

function entityS3Url(
  kind: "monsters" | "npcs" | "chars",
  id: string | number,
  variant: MonsterIconVariant | NpcIconVariant,
  cacheBust?: number,
): string {
  return assetUrl({
    media: "img",
    kind,
    id,
    size: variantToSize(variant),
    cacheBust,
  });
}

/** Прямая ссылка на объект в S3 (админка, проверка наличия). */
export function getMonsterS3Url(
  imageIdOrMonsterId: string | number,
  variant: MonsterIconVariant = "icon",
  cacheBust?: number,
): string {
  return entityS3Url(
    "monsters",
    resolveMonsterImageId(imageIdOrMonsterId),
    variant,
    cacheBust,
  );
}

export function getMonsterS3IconUrl(
  imageIdOrMonsterId: string | number,
  cacheBust?: number,
): string {
  return getMonsterS3Url(imageIdOrMonsterId, "icon", cacheBust);
}

export function getMonsterS3PreviewUrl(
  imageIdOrMonsterId: string | number,
  cacheBust?: number,
): string {
  return getMonsterS3Url(imageIdOrMonsterId, "preview", cacheBust);
}

/** Иконка монстра (S3). Списки, карта, игра. Предпочтительно передавать `monster.image`. */
export function getMonsterIconUrl(
  imageIdOrMonsterId: string | number,
  cacheBust?: number,
): string {
  return getMonsterS3IconUrl(imageIdOrMonsterId, cacheBust);
}

/** Оригинальный скриншот монстра с диска (админка). */
export function getMonsterLocalOriginalUrl(
  imageIdOrMonsterId: string | number,
  cacheBust = 0,
): string {
  const imageId = resolveMonsterImageId(imageIdOrMonsterId);
  return withOptionalCacheBust(
    `${API_URL}/icons/monster-original/${imageId}`,
    cacheBust,
  );
}

/** Локально сгенерированный PNG монстра (админка). */
export function getMonsterLocalGeneratedUrl(
  imageIdOrMonsterId: string | number,
  cacheBust = 0,
): string {
  const imageId = resolveMonsterImageId(imageIdOrMonsterId);
  return withOptionalCacheBust(
    `${API_URL}/icons/monster-generated/${imageId}`,
    cacheBust,
  );
}

/** Превью монстра (S3). Карточка, битва. */
export function getMonsterPreviewUrl(
  imageIdOrMonsterId: string | number,
  cacheBust?: number,
): string {
  return getMonsterS3PreviewUrl(imageIdOrMonsterId, cacheBust);
}

/** URL картинки монстра по варианту (S3). */
export function getMonsterIconFolderUrl(
  imageIdOrMonsterId: string | number,
  variant: MonsterIconVariant,
  cacheBust?: number,
): string {
  return getMonsterS3Url(imageIdOrMonsterId, variant, cacheBust);
}

/** Прямая ссылка NPC в S3. */
export function getNpcS3Url(
  imageIdOrNpcId: string | number,
  variant: NpcIconVariant = "icon",
  cacheBust?: number,
): string {
  return entityS3Url(
    "npcs",
    resolveNpcImageId(imageIdOrNpcId),
    variant,
    cacheBust,
  );
}

/** Иконка NPC (S3). Предпочтительно передавать `npc.image`. */
export function getNpcIconUrl(
  imageIdOrNpcId: string | number,
  cacheBust?: number,
): string {
  return getNpcS3Url(imageIdOrNpcId, "icon", cacheBust);
}

/** Превью NPC (S3). */
export function getNpcPreviewUrl(
  imageIdOrNpcId: string | number,
  cacheBust?: number,
): string {
  return getNpcS3Url(imageIdOrNpcId, "preview", cacheBust);
}

/** URL картинки NPC по варианту (S3). */
export function getNpcIconFolderUrl(
  imageIdOrNpcId: string | number,
  variant: NpcIconVariant,
  cacheBust?: number,
): string {
  return getNpcS3Url(imageIdOrNpcId, variant, cacheBust);
}

/** Оригинальный скриншот NPC с диска (админка). */
export function getNpcLocalOriginalUrl(
  imageIdOrNpcId: string | number,
  cacheBust = 0,
): string {
  const imageId = resolveNpcImageId(imageIdOrNpcId);
  return withOptionalCacheBust(
    `${API_URL}/icons/npc-original/${imageId}`,
    cacheBust,
  );
}

/** Локально сгенерированный PNG NPC (админка). */
export function getNpcLocalGeneratedUrl(
  imageIdOrNpcId: string | number,
  cacheBust = 0,
): string {
  const imageId = resolveNpcImageId(imageIdOrNpcId);
  return withOptionalCacheBust(
    `${API_URL}/icons/npc-generated/${imageId}`,
    cacheBust,
  );
}

export type CharAvatarIconVariant = "icon" | "preview" | "original";

/** Прямая ссылка аватара персонажа в S3 (`chars`). */
export function getCharAvatarS3Url(
  avatarId: number,
  variant: CharAvatarIconVariant = "icon",
  cacheBust?: number,
): string {
  return entityS3Url("chars", avatarId, variant, cacheBust);
}

export function getCharAvatarS3IconUrl(
  avatarId: number,
  cacheBust?: number,
): string {
  return getCharAvatarS3Url(avatarId, "icon", cacheBust);
}

export function getCharAvatarS3PreviewUrl(
  avatarId: number,
  cacheBust?: number,
): string {
  return getCharAvatarS3Url(avatarId, "preview", cacheBust);
}

/** Иконка аватара персонажа (S3). */
export function getCharAvatarIconUrl(
  avatarId: number,
  cacheBust?: number,
): string {
  return getCharAvatarS3IconUrl(avatarId, cacheBust);
}

/** Превью аватара персонажа (S3). */
export function getCharAvatarPreviewUrl(
  avatarId: number,
  cacheBust?: number,
): string {
  return getCharAvatarS3PreviewUrl(avatarId, cacheBust);
}

/** Оригинал аватара персонажа (S3). */
export function getCharAvatarOriginalUrl(
  avatarId: number,
  cacheBust?: number,
): string {
  return getCharAvatarS3Url(avatarId, "original", cacheBust);
}
