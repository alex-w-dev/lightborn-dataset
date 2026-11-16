import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { promises as fs } from "node:fs";
import { AssetEmbeddingsService } from "../admin/asset-embeddings.service";
import { DatasetSearchService } from "../admin/dataset-search.service";
import { assetGeneratedFile } from "../paths";

export type AssetImageRow = { id: string; description: string };

const CATALOGS = {
  "monster-images": "monster-images.json",
  "npc-images": "npc-images.json",
  "item-icons": "item-icons.json",
  "skill-icons": "skill-icons.json",
  "avatar-images": "avatar-images.json",
  "location-images": "location-images.json",
} as const;

export type CatalogKey = keyof typeof CATALOGS;

@Injectable()
export class CatalogsService {
  constructor(
    private readonly search: DatasetSearchService,
    private readonly embeddings: AssetEmbeddingsService,
  ) {}

  listKeys(): CatalogKey[] {
    return Object.keys(CATALOGS) as CatalogKey[];
  }

  async getAll(key: CatalogKey): Promise<AssetImageRow[]> {
    const fileName = CATALOGS[key];
    if (!fileName) throw new NotFoundException(`Unknown catalog: ${key}`);
    const raw = await fs.readFile(assetGeneratedFile(fileName), "utf8");
    const data = JSON.parse(raw) as AssetImageRow[];
    return Array.isArray(data) ? data : [];
  }

  async getOne(key: CatalogKey, id: string): Promise<AssetImageRow> {
    const rows = await this.getAll(key);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundException(`${key}/${id} not found`);
    return row;
  }

  async upsert(
    key: CatalogKey,
    row: AssetImageRow,
  ): Promise<AssetImageRow> {
    if (!row?.id || typeof row.id !== "string") {
      throw new BadRequestException("id is required");
    }
    const description =
      typeof row.description === "string" ? row.description : "";
    const rows = await this.getAll(key);
    const idx = rows.findIndex((r) => r.id === row.id);
    const prev = idx >= 0 ? rows[idx] : { id: row.id, description: "" };
    const next = { ...prev, id: row.id, description };
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
    rows.sort((a, b) => a.id.localeCompare(b.id, "en"));
    await this.write(key, rows);
    this.search.reindex();
    this.embeddings.scheduleReindex();
    return next;
  }

  async remove(key: CatalogKey, id: string): Promise<void> {
    const rows = await this.getAll(key);
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) {
      throw new NotFoundException(`${key}/${id} not found`);
    }
    await this.write(key, next);
    this.search.reindex();
    this.embeddings.scheduleReindex();
  }

  private async write(key: CatalogKey, rows: AssetImageRow[]): Promise<void> {
    const fileName = CATALOGS[key];
    await fs.writeFile(
      assetGeneratedFile(fileName),
      `${JSON.stringify(rows, null, 2)}\n`,
      "utf8",
    );
  }
}
