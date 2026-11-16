/** Публичный контракт ключей S3: `{media}/{kind}/{id}/{size}.{ext}`. */

export type AssetMedia = "img" | "music" | "sfx";

export type ImgKind =
  | "items"
  | "skills"
  | "ui"
  | "monsters"
  | "npcs"
  | "chars"
  | "backgrounds"
  | "locations";

export type MusicWaveKind = "peace" | "battle" | "lobby";

export type ImgSize = 64 | 512 | "original";

export const IMG_SIZES: readonly ImgSize[] = [64, 512, "original"] as const;

export const MUSIC_WAVE_KINDS: readonly MusicWaveKind[] = [
  "peace",
  "battle",
  "lobby",
] as const;

/** `g*` → items, `s*` → skills (legacy id без переименования). */
export function gameIconImgKind(iconId: string): "items" | "skills" {
  return String(iconId).trim().toLowerCase().startsWith("s")
    ? "skills"
    : "items";
}

/** Каталог JSON: items → `item-icons.json`, skills → `skill-icons.json`. */
export function gameIconCatalogFileName(
  iconId: string,
): "item-icons.json" | "skill-icons.json" {
  return gameIconImgKind(iconId) === "skills"
    ? "skill-icons.json"
    : "item-icons.json";
}

export function imgAssetKey(
  kind: ImgKind,
  id: string | number,
  size: ImgSize,
): string {
  return `img/${kind}/${id}/${size}.jpg`;
}

export function musicAssetPrefix(wave: MusicWaveKind): string {
  return `music/${wave}/`;
}

export function musicAssetKey(wave: MusicWaveKind, id: string): string {
  return `${musicAssetPrefix(wave)}${id}/original.ogg`;
}

/** Из `music/{wave}/{id}/original.ogg`. */
export function musicIdFromAssetKey(
  wave: MusicWaveKind,
  key: string,
): string | null {
  const prefix = musicAssetPrefix(wave);
  const suffix = "/original.ogg";
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
  const id = key.slice(prefix.length, -suffix.length);
  if (!id || id.includes("/")) return null;
  return id;
}

export function sfxAssetKey(id: string): string {
  return `sfx/${id}/original.ogg`;
}

export function sfxCatalogKey(): string {
  return "sfx/catalog.json";
}

/** Id фона из catalog id или имени файла `login.jpeg` → `login`. */
export function backgroundAssetId(fileOrId: string): string {
  const raw = String(fileOrId ?? "")
    .trim()
    .replace(/^\/?bg\//, "")
    .replace(/^\/?img\/backgrounds\//, "");
  if (!raw) return "";
  if (!raw.includes(".") && !raw.includes("/")) return raw;
  const base = raw.split("/").pop() ?? raw;
  return base.replace(/\.[^.]+$/, "");
}

/** Id локации из catalog id или `goldhills-farms.jpg`. */
export function locationAssetId(fileOrId: string): string {
  const raw = String(fileOrId ?? "")
    .trim()
    .replace(/^\/?map\/locs\//, "")
    .replace(/^\/?img\/locations\//, "");
  if (!raw) return "";
  if (!raw.includes(".") && !raw.includes("/")) return raw;
  const base = raw.split("/").pop() ?? raw;
  return base.replace(/\.[^.]+$/, "");
}
