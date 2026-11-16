import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AdminMusicService,
  MUSIC_MAX_BYTES,
} from "./music-admin.service";
import { MusicCatalogService } from "./music-catalog.service";
import { isMusicWave } from "./music-catalog.types";

@Controller("admin")
export class MusicController {
  constructor(
    private readonly music: AdminMusicService,
    private readonly catalog: MusicCatalogService,
  ) {}

  @Get("music/catalog")
  async getMusicCatalog() {
    await this.music.syncMetaFromCatalog();
    return this.catalog.getCatalog();
  }

  @Get("music/:wave(peace|battle|lobby)")
  async getMusicWave(@Param("wave") wave: string) {
    if (!isMusicWave(wave)) {
      throw new BadRequestException("wave must be peace, battle or lobby");
    }
    await this.music.syncMetaFromCatalog();
    return { wave, tracks: this.music.listWave(wave) };
  }

  @Post("music/:wave(peace|battle|lobby)/upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MUSIC_MAX_BYTES } }),
  )
  async uploadMusic(
    @Param("wave") wave: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!isMusicWave(wave)) {
      throw new BadRequestException("wave must be peace, battle or lobby");
    }
    if (!file?.buffer) {
      throw new BadRequestException("File is required");
    }
    const result = await this.music.uploadTrack(
      wave,
      file.buffer,
      file.originalname,
    );
    return {
      ok: true,
      wave,
      id: result.id,
      url: result.url,
      bytes: result.bytes,
      format: result.format,
      converted: result.converted,
    };
  }

  @Delete("music/:wave(peace|battle|lobby)/:id")
  async deleteMusic(@Param("wave") wave: string, @Param("id") id: string) {
    if (!isMusicWave(wave)) {
      throw new BadRequestException("wave must be peace, battle or lobby");
    }
    const decodedId = (() => {
      try {
        return decodeURIComponent(id);
      } catch {
        return id;
      }
    })();
    await this.music.deleteTrack(wave, decodedId);
    return { ok: true, wave, id: decodedId };
  }
}
