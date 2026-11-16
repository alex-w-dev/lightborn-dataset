import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { IconService, IconType } from "./icon.service";

const ICON_TYPES: IconType[] = ["monster", "npc", "skill", "item", "chars"];

function parseType(type: string): IconType {
  if (ICON_TYPES.includes(type as IconType)) return type as IconType;
  throw new BadRequestException(
    `Invalid type: ${type}. Allowed: ${ICON_TYPES.join(", ")}`,
  );
}

function parseEntityId(id: string): string | number {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) throw new BadRequestException("id is required");
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

@Controller("icons")
export class IconsController {
  constructor(private readonly iconService: IconService) {}

  @Get(":type/:id/icon")
  async getIcon(
    @Param("type") typeStr: string,
    @Param("id") idParam: string,
    @Res() res: Response,
  ) {
    const type = parseType(typeStr);
    const id = parseEntityId(idParam);
    const buf = await this.iconService.getIcon(type, id);
    if (!buf) throw new NotFoundException(`Icon ${type}/${id} not found`);
    res.setHeader("Content-Type", "image/jpeg");
    res.send(buf);
  }

  @Get(":type/:id/preview")
  async getPreview(
    @Param("type") typeStr: string,
    @Param("id") idParam: string,
    @Res() res: Response,
  ) {
    const type = parseType(typeStr);
    const id = parseEntityId(idParam);
    const buf = await this.iconService.getPreview(type, id);
    if (!buf) throw new NotFoundException(`Preview ${type}/${id} not found`);
    res.setHeader("Content-Type", "image/jpeg");
    res.send(buf);
  }

  @Post(":type/:id/upload")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Param("type") typeStr: string,
    @Param("id") idParam: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new BadRequestException("File is required");
    const type = parseType(typeStr);
    const id = parseEntityId(idParam);
    await this.iconService.upload(type, id, file.buffer);
    return { ok: true, type, id };
  }
}
