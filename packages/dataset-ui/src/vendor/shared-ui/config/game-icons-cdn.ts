import {
  assetCdnCacheVersion,
  gameIconImgKind,
  imgAssetKey,
  musicAssetKey,
  sfxAssetKey,
  sfxCatalogKey,
  type ImgKind,
  type ImgSize,
  type MusicWaveKind,
} from "@l-fight/dataset";

/** Публичный CDN бакет `lfm`. */
export const GAME_ICONS_CDN_BASE = "https://storage.yandexcloud.net/lfm";

export function getGameIconsCdnBase(): string {
  return GAME_ICONS_CDN_BASE;
}

/**
 * Стабильный S3 URL + `?v=<major>`.
 * Админский bust после заливки — `&t=`, он не меняет кэш игроков.
 * Вместе с `Cache-Control: max-age=31536000, immutable` на объекте в S3.
 */
export function withS3AssetVersion(url: string, cacheBust?: number): string {
  const versioned = `${url}?v=${assetCdnCacheVersion()}`;
  if (cacheBust === undefined || cacheBust === 0) return versioned;
  return `${versioned}&t=${cacheBust}`;
}

/** Публичный URL по относительному ключу в бакете. */
export function buildPublicAssetUrl(
  relativePath: string,
  cacheBust?: number,
): string {
  const path = relativePath.replace(/^\/+/, "");
  return withS3AssetVersion(`${GAME_ICONS_CDN_BASE}/${path}`, cacheBust);
}

export function assetUrl(params: {
  media: "img";
  kind: ImgKind;
  id: string | number;
  size: ImgSize;
  cacheBust?: number;
}): string;
export function assetUrl(params: {
  media: "music";
  kind: MusicWaveKind;
  id: string;
  size?: "original";
  cacheBust?: number;
}): string;
export function assetUrl(params: {
  media: "sfx";
  id: string;
  size?: "original";
  cacheBust?: number;
}): string;
export function assetUrl(params: {
  media: "img" | "music" | "sfx";
  kind?: ImgKind | MusicWaveKind;
  id: string | number;
  size?: ImgSize | "original";
  cacheBust?: number;
}): string {
  if (params.media === "img") {
    const key = imgAssetKey(
      params.kind as ImgKind,
      params.id,
      (params.size ?? 512) as ImgSize,
    );
    return buildPublicAssetUrl(key, params.cacheBust);
  }
  if (params.media === "music") {
    const key = musicAssetKey(params.kind as MusicWaveKind, String(params.id));
    return buildPublicAssetUrl(key, params.cacheBust);
  }
  return buildPublicAssetUrl(sfxAssetKey(String(params.id)), params.cacheBust);
}

export function itemIconUrl(
  id: string,
  size: 64 | 512 = 64,
  cacheBust?: number,
): string {
  return assetUrl({ media: "img", kind: "items", id, size, cacheBust });
}

export function skillIconUrl(
  id: string,
  size: 64 | 512 = 64,
  cacheBust?: number,
): string {
  return assetUrl({ media: "img", kind: "skills", id, size, cacheBust });
}

export function uiIconUrl(
  id: string,
  size: 64 | 512 = 64,
  cacheBust?: number,
): string {
  return assetUrl({ media: "img", kind: "ui", id, size, cacheBust });
}

export function musicUrl(
  wave: MusicWaveKind,
  id: string,
  cacheBust?: number,
): string {
  return assetUrl({ media: "music", kind: wave, id, cacheBust });
}

export function sfxUrl(id: string, cacheBust?: number): string {
  return assetUrl({ media: "sfx", id, cacheBust });
}

export function sfxCatalogUrl(cacheBust?: number): string {
  return buildPublicAssetUrl(sfxCatalogKey(), cacheBust);
}

/**
 * Legacy: `g*` → items, `s*` → skills.
 * Новый код предпочитает `itemIconUrl` / `skillIconUrl`.
 */
export function buildGameIconUrl(
  icon: string,
  size: 64 | 512 = 64,
  cacheBust?: number,
): string {
  const kind = gameIconImgKind(icon);
  return assetUrl({ media: "img", kind, id: icon, size, cacheBust });
}

export function isGameIconCdnUrl(url: string): boolean {
  return (
    /\/img\/(items|skills)\/[^/]+\/(64|512)\.jpg/.test(url) ||
    /\/ico\/(64|512)\//.test(url)
  );
}
