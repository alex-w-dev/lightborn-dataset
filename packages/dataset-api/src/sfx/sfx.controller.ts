import { BadRequestException, Controller, Delete, Get, Param, Post, UploadedFile, UseInterceptors, Body } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SfxService, SFX_MAX_BYTES, SFX_PACK_MAX_BYTES } from "./sfx.service";

@Controller("sfx")
export class SfxController {
  constructor(private readonly sfx: SfxService) {}

  @Get("catalog")
  catalog() { return this.sfx.readCatalog(); }

  @Post(":id/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: SFX_MAX_BYTES } }))
  async upload(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException("File is required");
    const result = await this.sfx.replaceSfx(id, file.buffer, file.originalname);
    return { ok: true, id: result.id, bytes: result.bytes, format: result.format, converted: result.converted };
  }

  @Post(":baseId/upload-slices")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: SFX_PACK_MAX_BYTES } }))
  async uploadSlices(
    @Param("baseId") baseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body("startVariant") startVariantRaw: string,
    @Body("segments") segmentsRaw: string,
  ) {
    if (!file?.buffer) throw new BadRequestException("File is required");
    const startVariant = Number(startVariantRaw);
    let segments: Array<{ startSec: number; endSec: number; volume?: number }>;
    try { segments = JSON.parse(String(segmentsRaw ?? "")) as Array<{ startSec: number; endSec: number; volume?: number }>; }
    catch { throw new BadRequestException("segments must be a JSON array"); }
    const result = await this.sfx.replaceSfxSlices({ baseId, startVariant, buffer: file.buffer, originalName: file.originalname, segments });
    return { ok: true, baseId: result.baseId, written: result.written, variants: result.variants, format: result.format };
  }

  @Post(":baseId/variants")
  async duplicate(@Param("baseId") baseId: string) {
    const result = await this.sfx.duplicateLastSfxVariant(baseId);
    return { ok: true, ...result };
  }

  @Delete(":baseId/variants/:variant")
  async removeVariant(@Param("baseId") baseId: string, @Param("variant") variantRaw: string) {
    const variant = Number(variantRaw);
    if (!Number.isFinite(variant)) throw new BadRequestException("variant must be a number");
    return { ok: true, ...(await this.sfx.deleteSfxVariant(baseId, variant)) };
  }
}
