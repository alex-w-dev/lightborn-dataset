import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED = path.resolve(
  __dirname,
  "../../dataset/src/generated",
);

export const ASSET_TYPES = [
  "monster-images",
  "npc-images",
  "icons",
  "backgrounds",
  "avatar-images",
  "location-images",
  "sfx",
  "music",
];

function readJson(name) {
  try {
    return JSON.parse(readFileSync(path.join(GENERATED, name), "utf8"));
  } catch {
    return null;
  }
}

function asArray(raw) {
  return Array.isArray(raw) ? raw : [];
}

/** @returns {Array<{ type: string, id: string, text: string, meta?: Record<string, string> }>} */
export function loadAssetDocs() {
  /** @type {Array<{ type: string, id: string, text: string, meta?: Record<string, string> }>} */
  const docs = [];

  for (const row of asArray(readJson("monster-images.json"))) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    docs.push({
      type: "monster-images",
      id,
      text: String(row?.description ?? "").trim(),
    });
  }
  for (const row of asArray(readJson("npc-images.json"))) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    docs.push({
      type: "npc-images",
      id,
      text: String(row?.description ?? "").trim(),
    });
  }
  for (const fileName of ["item-icons.json", "skill-icons.json"]) {
    for (const row of asArray(readJson(fileName))) {
      const id = String(row?.id ?? "").trim();
      if (!id) continue;
      docs.push({
        type: "icons",
        id,
        text: String(row?.description ?? "").trim(),
      });
    }
  }
  for (const row of asArray(readJson("backgrounds.json"))) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    const name = String(row?.name ?? "").trim();
    const desc = String(row?.description ?? "").trim();
    docs.push({
      type: "backgrounds",
      id,
      text: [name, desc].filter(Boolean).join(" — "),
      meta: { name },
    });
  }
  for (const row of asArray(readJson("avatar-images.json"))) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    docs.push({
      type: "avatar-images",
      id,
      text: String(row?.description ?? "").trim(),
    });
  }
  for (const row of asArray(readJson("location-images.json"))) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    docs.push({
      type: "location-images",
      id,
      text: String(row?.description ?? "").trim(),
    });
  }
  for (const row of asArray(readJson("sfx.json"))) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    docs.push({
      type: "sfx",
      id,
      text: String(row?.description ?? "").trim(),
    });
  }
  for (const row of asArray(readJson("music.json"))) {
    const id = String(row?.id ?? "").trim();
    const wave = String(row?.wave ?? "").trim();
    if (!id || !wave) continue;
    docs.push({
      type: "music",
      id: `${wave}/${id}`,
      text: String(row?.description ?? "").trim(),
      meta: { wave, trackId: id },
    });
  }

  return docs;
}

export function contentHash(text) {
  return createHash("sha1").update(text).digest("hex");
}

export function cachePath() {
  return path.resolve(
    __dirname,
    "../../dataset/.cache/asset-embeddings.json",
  );
}
