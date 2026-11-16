/**
 * Major для query `?v=` у публичных S3-ассетов общего датасета.
 * Не зависит от Lightborn GAME_DATA_VERSION.
 */
export const ASSET_CDN_CACHE_VERSION = 14;

export function assetCdnCacheVersion(
  version: number = ASSET_CDN_CACHE_VERSION,
): number {
  return Number(version) || ASSET_CDN_CACHE_VERSION;
}
