import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AdminBackgroundsService,
  BACKGROUNDS_MAX_BYTES,
} from "./backgrounds-admin.service";

@Controller("admin/backgrounds")
export class BackgroundsController {
  constructor(private readonly backgrounds: AdminBackgroundsService) {}

  @Get("catalog")
  getCatalog() {
    return { backgrounds: this.backgrounds.listCatalog() };
  }

  @Get("s3")
  async listS3() {
    const files = await this.backgrounds.listS3Files();
    return { files };
  }

  @Post(":id/upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: BACKGROUNDS_MAX_BYTES } }),
  )
  async upload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("File is required");
    }
    const result = await this.backgrounds.uploadForId(
      id,
      file.buffer,
      file.originalname,
    );
    return { ok: true, ...result };
  }
}
