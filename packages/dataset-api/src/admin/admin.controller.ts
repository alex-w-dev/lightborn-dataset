import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { GameIconsService } from "../game-icons/game-icons.service";
import { SfxService, SFX_MAX_BYTES, SFX_PACK_MAX_BYTES } from "../sfx/sfx.service";
import { AdminEntitiesService } from "./admin-entities.service";
import { AssetEmbeddingsService } from "./asset-embeddings.service";
import {
  DatasetSearchService,
  type DatasetSearchType,
} from "./dataset-search.service";

@Controller("admin")
export class AdminController {
  constructor(
    private readonly entities: AdminEntitiesService,
    private readonly gameIcons: GameIconsService,
    private readonly sfx: SfxService,
    private readonly search: DatasetSearchService,
    private readonly embeddings: AssetEmbeddingsService,
  ) {}

  @Get()
  info() {
    return {
      message: "Dataset admin API (assets)",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("search")
  async searchDataset(
    @Query("q") q?: string,
    @Query("types") types?: string,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    const parsedTypes = String(types ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean) as DatasetSearchType[];
    return this.search.search({
      q: String(q ?? ""),
      types: parsedTypes.length > 0 ? parsedTypes : undefined,
      limit,
    });
  }

  @Get("search/status")
  searchStatus() {
    return this.search.status();
  }

  @Post("search/reindex")
  async searchReindex() {
    const lexical = this.search.reindex();
    const embeddings = await this.embeddings.reindexNow();
    return { ...lexical, embeddings };
  }

  // --- game-icons ---
  @Get("game-icons/raw")
  giRaw() {
    return this.gameIcons.listRaw();
  }

  @Post("game-icons/from-clipboard")
  giClipboard(@Body() body: Record<string, unknown>) {
    return this.gameIcons.fromClipboard(body as never);
  }

  @Post("game-icons/raw")
  giSaveRaw(@Body() body: Record<string, unknown>) {
    return this.gameIcons.saveRaw(body as never);
  }

  @Post("game-icons/raw/apply")
  giApplyRaw(@Body() body: { icon?: string }) {
    return this.gameIcons.applyRawAsIs(String(body?.icon ?? ""));
  }

  @Post("game-icons/restore-from-s3")
  giRestore(@Body() body: { icon?: string }) {
    return this.gameIcons.restoreFromS3(String(body?.icon ?? ""));
  }

  @Post("game-icons/transform")
  giTransform(
    @Body() body: { icon?: string; op?: "flipHorizontal" | "rotate180" },
  ) {
    return this.gameIcons.transformLocal(
      String(body?.icon ?? ""),
      body?.op as "flipHorizontal" | "rotate180",
    );
  }

  @Delete("game-icons/raw/:icon")
  giDeleteRaw(@Param("icon") icon: string) {
    return this.gameIcons.deleteRaw(icon);
  }

  @Get("game-icons/pending-sync")
  giPending() {
    return this.gameIcons.listPendingSync();
  }

  @Delete("game-icons/pending-sync/:icon")
  giClearPending(@Param("icon") icon: string) {
    return this.gameIcons.clearPendingSyncIcon(icon);
  }

  @Get("game-icons/need-local-update")
  giNeedLocal() {
    return this.gameIcons.listNeedLocalUpdate();
  }

  @Put("game-icons/need-local-update")
  giWriteNeedLocal(@Body() body: { icons?: string[] }) {
    return this.gameIcons.writeNeedLocalUpdateIconsList(body?.icons ?? []);
  }

  @Post("game-icons/apply")
  giApply(@Body() body: Record<string, unknown>) {
    return this.gameIcons.apply(body as never);
  }

  @Get("game-icons/s3-source/:icon")
  giS3(@Param("icon") icon: string) {
    return this.gameIcons.readS3Source(icon);
  }

  @Get("game-icons/retouch/raw")
  giRetouchRaw() {
    return this.gameIcons.listRetouchRaw();
  }

  @Post("game-icons/retouch/raw")
  giRetouchSave(@Body() body: Record<string, unknown>) {
    return this.gameIcons.saveRetouchRaw(body as never);
  }

  @Post("game-icons/retouch/raw/apply")
  giRetouchApplyRaw(@Body() body: { icon?: string }) {
    return this.gameIcons.applyRetouchRaw(String(body?.icon ?? ""));
  }

  @Post("game-icons/retouch/from-clipboard")
  giRetouchClipboard(@Body() body: Record<string, unknown>) {
    return this.gameIcons.fromRetouchClipboard(body as never);
  }

  @Get("game-icons/retouch/pending-sync")
  giRetouchPending() {
    return this.gameIcons.listRetouchPendingSync();
  }

  @Delete("game-icons/retouch/pending-sync/:icon")
  giRetouchClearPending(@Param("icon") icon: string) {
    return this.gameIcons.clearRetouchPendingSyncIcon(icon);
  }

  @Get("game-icons/retouch/need-local-update")
  giRetouchNeedLocal() {
    return this.gameIcons.listRetouchNeedLocalUpdate();
  }

  @Get("game-icons/retouch/updated-locally")
  giRetouchUpdatedLocal() {
    return this.gameIcons.listRetouchUpdatedLocally();
  }

  @Get("game-icons/retouch/updated-in-s3")
  giRetouchUpdatedS3() {
    return this.gameIcons.listRetouchUpdatedInS3();
  }

  @Post("game-icons/retouch/transform")
  giRetouchTransform(
    @Body() body: { icon?: string; op?: "flipHorizontal" | "rotate180" },
  ) {
    return this.gameIcons.transformRetouchLocal(
      String(body?.icon ?? ""),
      body?.op as "flipHorizontal" | "rotate180",
    );
  }

  @Post("game-icons/retouch/apply")
  giRetouchApply(@Body() body: Record<string, unknown>) {
    return this.gameIcons.applyRetouch(body as never);
  }

  // --- sfx ---
  @Get("sfx/catalog")
  sfxCatalog() {
    return this.sfx.readCatalog();
  }

  @Post("sfx/:id/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: SFX_MAX_BYTES } }))
  async sfxUpload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new BadRequestException("File is required");
    const result = await this.sfx.replaceSfx(id, file.buffer, file.originalname);
    return {
      ok: true,
      id: result.id,
      bytes: result.bytes,
      format: result.format,
      converted: result.converted,
    };
  }

  @Post("sfx/:baseId/upload-slices")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: SFX_PACK_MAX_BYTES } }),
  )
  async sfxSlices(
    @Param("baseId") baseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body("startVariant") startVariantRaw: string,
    @Body("segments") segmentsRaw: string,
  ) {
    if (!file?.buffer) throw new BadRequestException("File is required");
    const startVariant = Number(startVariantRaw);
    let segments: Array<{ startSec: number; endSec: number; volume?: number }>;
    try {
      segments = JSON.parse(String(segmentsRaw ?? "")) as Array<{
        startSec: number;
        endSec: number;
        volume?: number;
      }>;
    } catch {
      throw new BadRequestException("segments must be a JSON array");
    }
    const result = await this.sfx.replaceSfxSlices({
      baseId,
      startVariant,
      buffer: file.buffer,
      originalName: file.originalname,
      segments,
    });
    return {
      ok: true,
      baseId: result.baseId,
      written: result.written,
      variants: result.variants,
      format: result.format,
    };
  }

  @Post("sfx/:baseId/variants")
  async sfxDup(@Param("baseId") baseId: string) {
    const result = await this.sfx.duplicateLastSfxVariant(baseId);
    return { ok: true, ...result };
  }

  @Delete("sfx/:baseId/variants/:variant")
  async sfxDelVariant(
    @Param("baseId") baseId: string,
    @Param("variant", ParseIntPipe) variant: number,
  ) {
    return { ok: true, ...(await this.sfx.deleteSfxVariant(baseId, variant)) };
  }

  @Get(":resource/raw")
  getRaw(@Param("resource") resource: string) {
    return this.entities.getRawJson(resource);
  }

  @Put(":resource/raw")
  putRaw(@Param("resource") resource: string, @Body() body: unknown) {
    return this.entities.putRawJson(resource, body);
  }
}
