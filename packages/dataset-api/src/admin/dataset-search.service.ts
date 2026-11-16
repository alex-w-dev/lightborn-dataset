import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { AssetEmbeddingsService } from "./asset-embeddings.service";
import { readGeneratedJsonSync } from "./dataset-files";

export type DatasetSearchType =
  | "icons"
  | "monster-images"
  | "npc-images"
  | "locations"
  | "backgrounds"
  | "sfx"
  | "music";

export type DatasetSearchHit = {
  type: DatasetSearchType;
  id: string;
  title: string;
  snippet: string;
  score: number;
};

type IndexRow = {
  type: DatasetSearchType;
  id: string;
  title: string;
  text: string;
  haystack: string;
};

const ALL_TYPES: DatasetSearchType[] = [
  "icons",
  "monster-images",
  "npc-images",
  "locations",
  "backgrounds",
  "sfx",
  "music",
];

/** Admin `locations` ↔ embeddings `location-images`. */
function toEmbeddingType(type: DatasetSearchType): string {
  return type === "locations" ? "location-images" : type;
}

function fromEmbeddingType(type: string): DatasetSearchType | null {
  if (type === "location-images") return "locations";
  if ((ALL_TYPES as string[]).includes(type)) return type as DatasetSearchType;
  return null;
}

function asArray<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

function clipSnippet(text: string, query: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const q = query.trim().toLowerCase();
  const idx = q ? flat.toLowerCase().indexOf(q.split(/\s+/)[0] ?? q) : -1;
  if (idx < 0) {
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
  }
  const start = Math.max(0, idx - 40);
  const end = Math.min(flat.length, start + max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return `${prefix}${flat.slice(start, end)}${suffix}`;
}

function scoreRow(row: IndexRow, tokens: string[], rawQuery: string): number {
  let score = 0;
  const idLower = row.id.toLowerCase();
  const titleLower = row.title.toLowerCase();
  if (rawQuery && idLower === rawQuery) score += 100;
  else if (rawQuery && idLower.includes(rawQuery)) score += 40;
  if (rawQuery && titleLower === rawQuery) score += 50;
  else if (rawQuery && titleLower.includes(rawQuery)) score += 25;
  for (const token of tokens) {
    if (idLower.includes(token)) score += 15;
    if (titleLower.includes(token)) score += 10;
    if (row.haystack.includes(token)) score += 3;
  }
  return score;
}

@Injectable()
export class DatasetSearchService implements OnModuleInit {
  private readonly logger = new Logger(DatasetSearchService.name);
  private rows: IndexRow[] = [];
  private builtAt: string | null = null;

  constructor(private readonly embeddings: AssetEmbeddingsService) {}

  onModuleInit() {
    this.reindex();
  }

  private safeRead(fileName: string): unknown {
    try {
      return readGeneratedJsonSync(fileName);
    } catch {
      return null;
    }
  }

  reindex(): { count: number; builtAt: string } {
    const rows: IndexRow[] = [];

    const monsterImages = asArray<{ id?: string; description?: string }>(
      this.safeRead("monster-images.json"),
    );
    for (const row of monsterImages) {
      const idStr = String(row.id ?? "").trim();
      if (!idStr) continue;
      const description = String(row.description ?? "").trim();
      rows.push({
        type: "monster-images",
        id: idStr,
        title: idStr,
        text: description,
        haystack: `${idStr} ${description}`.toLowerCase(),
      });
    }

    const npcImages = asArray<{ id?: string; description?: string }>(
      this.safeRead("npc-images.json"),
    );
    for (const row of npcImages) {
      const idStr = String(row.id ?? "").trim();
      if (!idStr) continue;
      const description = String(row.description ?? "").trim();
      rows.push({
        type: "npc-images",
        id: idStr,
        title: idStr,
        text: description,
        haystack: `${idStr} ${description}`.toLowerCase(),
      });
    }

    for (const fileName of ["item-icons.json", "skill-icons.json"] as const) {
      const icons = asArray<{ id?: string; description?: string }>(
        this.safeRead(fileName),
      );
      for (const row of icons) {
        const id = String(row.id ?? "").trim();
        if (!id) continue;
        const text = String(row.description ?? "").trim();
        rows.push({
          type: "icons",
          id,
          title: id,
          text,
          haystack: `${id} ${text}`.toLowerCase(),
        });
      }
    }

    const backgrounds = asArray<{
      id?: string;
      name?: string;
      file?: string;
      description?: string;
    }>(this.safeRead("backgrounds.json"));
    for (const row of backgrounds) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const title = String(row.name ?? id).trim() || id;
      const text = String(row.description ?? "").trim();
      const file = String(row.file ?? "").trim();
      rows.push({
        type: "backgrounds",
        id,
        title,
        text,
        haystack: `${id} ${title} ${file} ${text}`.toLowerCase(),
      });
    }

    const locationImages = asArray<{
      id?: string;
      file?: string;
      description?: string;
    }>(this.safeRead("location-images.json"));
    for (const row of locationImages) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const text = String(row.description ?? "").trim();
      rows.push({
        type: "locations",
        id,
        title: id,
        text,
        haystack: `${id} ${text}`.toLowerCase(),
      });
    }

    const sfx = asArray<{ id?: string; description?: string }>(
      this.safeRead("sfx.json"),
    );
    for (const row of sfx) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const text = String(row.description ?? "").trim();
      rows.push({
        type: "sfx",
        id,
        title: id,
        text,
        haystack: `${id} ${text}`.toLowerCase(),
      });
    }

    const music = asArray<{
      id?: string;
      wave?: string;
      description?: string;
    }>(this.safeRead("music.json"));
    for (const row of music) {
      const id = String(row.id ?? "").trim();
      const wave = String(row.wave ?? "").trim();
      if (!id || !wave) continue;
      const text = String(row.description ?? "").trim();
      rows.push({
        type: "music",
        id: `${wave}/${id}`,
        title: id,
        text,
        haystack: `${wave} ${id} ${text}`.toLowerCase(),
      });
    }

    this.rows = rows;
    this.builtAt = new Date().toISOString();
    return { count: rows.length, builtAt: this.builtAt };
  }

  async search(params: {
    q: string;
    types?: DatasetSearchType[];
    limit?: number;
  }): Promise<{
    items: DatasetSearchHit[];
    total: number;
    builtAt: string | null;
    indexed: number;
  }> {
    const q = String(params.q ?? "").trim();
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const types =
      params.types && params.types.length > 0 ? params.types : ALL_TYPES;
    const typeSet = new Set(types);
    const rawQuery = q.toLowerCase();
    const tokens = rawQuery.split(/\s+/).filter((t) => t.length > 0);

    if (tokens.length === 0) {
      return {
        items: [],
        total: 0,
        builtAt: this.builtAt,
        indexed: this.rows.length,
      };
    }

    const merged = new Map<string, DatasetSearchHit>();
    const rowByKey = new Map<string, IndexRow>(
      this.rows.map((row) => [`${row.type}:${row.id}`, row]),
    );

    for (const row of this.rows) {
      if (!typeSet.has(row.type)) continue;
      if (!tokens.every((token) => row.haystack.includes(token))) continue;
      const score = scoreRow(row, tokens, rawQuery);
      if (score <= 0) continue;
      merged.set(`${row.type}:${row.id}`, {
        type: row.type,
        id: row.id,
        title: row.title,
        snippet: clipSnippet(row.text || row.title, q),
        score,
      });
    }

    try {
      const semantic = await this.embeddings.search(q, {
        types: types.map(toEmbeddingType),
        limit: Math.min(Math.max(limit * 2, 40), 100),
      });
      for (const hit of semantic) {
        const type = fromEmbeddingType(hit.type);
        if (!type || !typeSet.has(type)) continue;
        const key = `${type}:${hit.id}`;
        const row = rowByKey.get(key);
        const semanticScore = Math.max(0, Number(hit.score) || 0) * 100;
        const prev = merged.get(key);
        if (prev) {
          prev.score += semanticScore;
          continue;
        }
        if (semanticScore < 58) continue;
        merged.set(key, {
          type,
          id: hit.id,
          title: row?.title ?? hit.id,
          snippet: clipSnippet(row?.text || hit.text || hit.id, q),
          score: semanticScore,
        });
      }
    } catch (err) {
      this.logger.warn(
        `semantic search failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const hits = [...merged.values()];
    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "en"));
    return {
      items: hits.slice(0, limit),
      total: hits.length,
      builtAt: this.builtAt,
      indexed: this.rows.length,
    };
  }

  status() {
    return {
      indexed: this.rows.length,
      builtAt: this.builtAt,
      types: ALL_TYPES,
    };
  }
}
