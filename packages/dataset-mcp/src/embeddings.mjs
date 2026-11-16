import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { cachePath, contentHash, loadAssetDocs } from "./catalog.mjs";

const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MODEL_TAG = "mMiniLM-v1";

/** @type {Promise<import("@xenova/transformers").FeatureExtractionPipeline> | null} */
let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID);
  }
  return extractorPromise;
}

/**
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const extractor = await getExtractor();
  const input = String(text ?? "").trim() || "empty";
  const output = await extractor(input, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

function loadCache() {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf8"));
  } catch {
    return { model: MODEL_TAG, items: {} };
  }
}

function saveCache(cache) {
  mkdirSync(path.dirname(cachePath()), { recursive: true });
  writeFileSync(cachePath(), `${JSON.stringify(cache)}\n`, "utf8");
}

/**
 * @returns {Promise<{ count: number, updated: number, model: string }>}
 */
export async function reindexEmbeddings() {
  const docs = loadAssetDocs();
  let cache = loadCache();
  if (cache.model !== MODEL_TAG) {
    cache = { model: MODEL_TAG, items: {} };
  }
  let updated = 0;
  for (const doc of docs) {
    const key = `${doc.type}:${doc.id}`;
    const hash = contentHash(`${doc.id}\n${doc.text}`);
    const prev = cache.items[key];
    if (prev && prev.hash === hash && Array.isArray(prev.vector)) continue;
    cache.items[key] = {
      type: doc.type,
      id: doc.id,
      text: doc.text,
      meta: doc.meta ?? {},
      hash,
      vector: await embedText(`${doc.id}. ${doc.text}`),
    };
    updated += 1;
  }
  const live = new Set(docs.map((d) => `${d.type}:${d.id}`));
  for (const key of Object.keys(cache.items)) {
    if (!live.has(key)) delete cache.items[key];
  }
  cache.model = MODEL_TAG;
  saveCache(cache);
  return { count: Object.keys(cache.items).length, updated, model: MODEL_TAG };
}

/**
 * @param {string} query
 * @param {{ types?: string[], limit?: number }} [opts]
 */
export async function searchAssets(query, opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 100);
  const typeSet =
    opts.types && opts.types.length > 0 ? new Set(opts.types) : null;
  let cache = loadCache();
  if (
    cache.model !== MODEL_TAG ||
    Object.keys(cache.items).length === 0
  ) {
    await reindexEmbeddings();
    cache = loadCache();
  }
  const qVec = await embedText(query);
  /** @type {Array<{ type: string, id: string, text: string, score: number, meta?: object }>} */
  const hits = [];
  for (const item of Object.values(cache.items)) {
    if (typeSet && !typeSet.has(item.type)) continue;
    hits.push({
      type: item.type,
      id: item.id,
      text: item.text,
      meta: item.meta,
      score: cosine(qVec, item.vector),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function getAsset(type, id) {
  const docs = loadAssetDocs();
  return docs.find((d) => d.type === type && d.id === id) ?? null;
}
