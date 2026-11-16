import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ADMIN_ASSET_DATASET_FILES,
  ADMIN_WRITABLE_DATASET_RESOURCES,
  readGeneratedJson,
  validateWritableBody,
  writeGeneratedJson,
} from "./dataset-files";
import { DatasetSearchService } from "./dataset-search.service";
import { AssetEmbeddingsService } from "./asset-embeddings.service";

@Injectable()
export class AdminEntitiesService {
  constructor(
    private readonly search: DatasetSearchService,
    private readonly embeddings: AssetEmbeddingsService,
  ) {}

  async getRawJson(resource: string): Promise<unknown> {
    const asset = ADMIN_ASSET_DATASET_FILES[resource];
    if (asset) return readGeneratedJson(asset);
    throw new NotFoundException(`Unknown dataset resource: ${resource}`);
  }

  async putRawJson(resource: string, body: unknown): Promise<unknown> {
    const asset = ADMIN_ASSET_DATASET_FILES[resource];
    if (!asset) {
      throw new NotFoundException(`Unknown dataset resource: ${resource}`);
    }
    if (!ADMIN_WRITABLE_DATASET_RESOURCES.has(resource)) {
      throw new BadRequestException(
        `Dataset resource is read-only: ${resource}`,
      );
    }
    const validated = validateWritableBody(resource, body);
    await writeGeneratedJson(asset, validated);
    this.search.reindex();
    this.embeddings.scheduleReindex();
    return validated;
  }
}
