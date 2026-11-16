import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  getBackgroundById,
  imgAssetKey,
  listBackgrounds,
  type BackgroundEntry,
} from "@l-fight/dataset";
import sharp from "sharp";
import { S3Service } from "../s3/s3.service";

export const BACKGROUNDS_MAX_BYTES = 12 * 1024 * 1024;

@Injectable()
export class AdminBackgroundsService {
  constructor(private readonly s3: S3Service) {}

  listCatalog(): BackgroundEntry[] {
    return listBackgrounds();
  }

  async listS3Files(): Promise<string[]> {
    const keys = await this.s3.listKeys("img/backgrounds/");
    const ids = new Set<string>();
    for (const key of keys) {
      const m = /^img\/backgrounds\/([^/]+)\/(64|512|original)\.jpg$/.exec(key);
      if (m) ids.add(m[1]);
    }
    return [...ids].sort((a, b) => a.localeCompare(b, "en"));
  }

  async uploadForId(
    id: string,
    buffer: Buffer,
    _originalName: string,
  ): Promise<{ id: string; file: string; key: string; url?: string }> {
    const entry = getBackgroundById(id);
    if (!entry) {
      throw new NotFoundException(`Unknown background id: ${id}`);
    }
    if (buffer.byteLength > BACKGROUNDS_MAX_BYTES) {
      throw new BadRequestException("File too large");
    }

    const jpegOpts = { quality: 90 };
    const original = await sharp(buffer).jpeg(jpegOpts).toBuffer();
    const jpeg512 = await sharp(original)
      .resize(512, 512, { fit: "cover" })
      .jpeg(jpegOpts)
      .toBuffer();
    const jpeg64 = await sharp(original)
      .resize(64, 64, { fit: "cover" })
      .jpeg(jpegOpts)
      .toBuffer();

    const keyOriginal = imgAssetKey("backgrounds", entry.id, "original");
    const key512 = imgAssetKey("backgrounds", entry.id, 512);
    const key64 = imgAssetKey("backgrounds", entry.id, 64);
    const [uploaded] = await Promise.all([
      this.s3.uploadFile({
        key: key512,
        body: jpeg512,
        contentType: "image/jpeg",
      }),
      this.s3.uploadFile({
        key: key64,
        body: jpeg64,
        contentType: "image/jpeg",
      }),
      this.s3.uploadFile({
        key: keyOriginal,
        body: original,
        contentType: "image/jpeg",
      }),
    ]);

    return {
      id: entry.id,
      file: entry.file,
      key: uploaded.key,
      url: uploaded.url,
    };
  }
}
