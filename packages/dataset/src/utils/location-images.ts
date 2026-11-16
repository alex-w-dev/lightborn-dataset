import locationImagesJson from "../generated/location-images.json";
import { imgAssetKey, locationAssetId } from "./asset-paths";

/** @deprecated legacy; публичные ключи — `img/locations/{id}/{size}.jpg`. */
export const MAP_LOCS_DIR = "img/locations";

export type LocationImageEntry = {
  id: string;
  file: string;
  description: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(raw: unknown, index: number): LocationImageEntry {
  if (!isObject(raw)) {
    throw new Error(`location-images[${index}]: must be an object`);
  }
  const id = String(raw.id ?? "").trim();
  const file = String(raw.file ?? "").trim();
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  if (!id) throw new Error(`location-images[${index}]: id required`);
  if (!file) throw new Error(`location-images[${index}]: file required`);
  if (!/^[a-zA-Z0-9._-]+\.(jpe?g|png|webp)$/i.test(file)) {
    throw new Error(
      `location-images[${index}]: file must be a simple image filename`,
    );
  }
  return { id, file, description };
}

export function parseLocationImagesFile(body: unknown): LocationImageEntry[] {
  if (!Array.isArray(body)) {
    throw new Error("location-images: root must be an array");
  }
  const seen = new Set<string>();
  const rows = body.map((row, i) => parseEntry(row, i));
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`location-images: duplicate id "${row.id}"`);
    }
    seen.add(row.id);
  }
  return rows;
}

const CATALOG = parseLocationImagesFile(locationImagesJson);

export function listLocationImages(): LocationImageEntry[] {
  return CATALOG.slice();
}

export function getLocationImageById(
  id: string,
): LocationImageEntry | undefined {
  return CATALOG.find((row) => row.id === id);
}

/** Относительный ключ в CDN/S3: `img/locations/{id}/512.jpg`. */
export function locationImageObjectKey(fileOrId: string): string {
  const byId = getLocationImageById(fileOrId);
  const id = byId?.id ?? locationAssetId(fileOrId);
  return imgAssetKey("locations", id, 512);
}
