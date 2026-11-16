import backgroundsJson from "../generated/backgrounds.json";
import { backgroundAssetId, imgAssetKey } from "./asset-paths";

/** @deprecated legacy prefix; публичные ключи — `img/backgrounds/{id}/{size}.jpg`. */
export const BG_S3_DIR = "img/backgrounds";

/** Запись общего каталога фонов (без game-specific roles). */
export type BackgroundEntry = {
  id: string;
  /** Legacy имя файла; публичный ключ строится по `id`. */
  file: string;
  name: string;
  description: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(raw: unknown, index: number): BackgroundEntry {
  if (!isObject(raw)) {
    throw new Error(`backgrounds[${index}]: must be an object`);
  }
  const id = String(raw.id ?? "").trim();
  const file = String(raw.file ?? "").trim();
  const name = String(raw.name ?? "").trim();
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  if (!id) throw new Error(`backgrounds[${index}]: id required`);
  if (!file) throw new Error(`backgrounds[${index}]: file required`);
  if (!/^[a-zA-Z0-9._-]+\.(jpe?g|png|webp)$/i.test(file)) {
    throw new Error(
      `backgrounds[${index}]: file must be a simple image filename`,
    );
  }
  if (!name) throw new Error(`backgrounds[${index}]: name required`);
  return { id, file, name, description };
}

export function parseBackgroundsFile(body: unknown): BackgroundEntry[] {
  if (!Array.isArray(body)) {
    throw new Error("backgrounds: root must be an array");
  }
  const seen = new Set<string>();
  const rows = body.map((row, i) => parseEntry(row, i));
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`backgrounds: duplicate id "${row.id}"`);
    }
    seen.add(row.id);
  }
  return rows;
}

const CATALOG = parseBackgroundsFile(backgroundsJson);

export function listBackgrounds(): BackgroundEntry[] {
  return CATALOG.slice();
}

export function getBackgroundById(id: string): BackgroundEntry | undefined {
  return CATALOG.find((b) => b.id === id);
}

/** Относительный ключ в CDN/S3: `img/backgrounds/{id}/512.jpg`. */
export function backgroundObjectKey(fileOrId: string): string {
  const raw = String(fileOrId ?? "").trim();
  const byId = getBackgroundById(raw);
  if (byId) return imgAssetKey("backgrounds", byId.id, 512);
  const stem = backgroundAssetId(raw);
  const byFile = CATALOG.find(
    (b) =>
      b.file === raw ||
      backgroundAssetId(b.file) === stem ||
      b.id === stem,
  );
  return imgAssetKey("backgrounds", byFile?.id ?? stem, 512);
}
