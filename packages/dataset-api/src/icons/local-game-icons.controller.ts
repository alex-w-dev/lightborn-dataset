import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { promises as fs } from "fs";
import * as path from "path";
import { IconPathResolver } from "./icon-path.resolver";
import {
  defaultLocalIconsDir,
  localIconsLeafDir,
} from "./local-icons-paths";

/** Локальные PNG иконок для dataset-ui (`/icons/public|generated|raw|…`). */
@Controller("icons")
export class LocalGameIconsController {
  private readonly logger = new Logger(LocalGameIconsController.name);
  private readonly generatedIconsPath: string;
  private readonly generatedIconsPathNormalized: string;
  private readonly rawIconsPath: string;
  private readonly rawIconsPathNormalized: string;

  constructor(
    private readonly iconPathResolver: IconPathResolver,
    private readonly configService: ConfigService,
  ) {
    const customPath = this.configService.get<string>("ICONS_512_NEW_ROOT");
    this.generatedIconsPath = customPath?.trim()
      ? path.resolve(customPath.trim())
      : defaultLocalIconsDir("All-512-new");
    this.generatedIconsPathNormalized = path.resolve(this.generatedIconsPath);
    const rawCustom = this.configService.get<string>("ICONS_RAW_ROOT");
    this.rawIconsPath = rawCustom?.trim()
      ? path.resolve(rawCustom.trim())
      : defaultLocalIconsDir("All-raw");
    this.rawIconsPathNormalized = path.resolve(this.rawIconsPath);
  }

  @Get("public/:icon")
  async getPublicIcon(@Param("icon") icon: string, @Res() res: Response) {
    let filePath = "";
    try {
      filePath = this.iconPathResolver.resolvePngPath(icon);
    } catch (error) {
      this.logger.warn(
        `Public icon path blocked: icon="${icon}", error="${(error as Error).message}"`,
      );
      throw new NotFoundException("Invalid icon path");
    }
    try {
      await fs.access(filePath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(filePath);
    } catch {
      throw new NotFoundException(`Icon ${icon} not found`);
    }
  }

  @Get("generated/:icon")
  async getGeneratedIcon(@Param("icon") icon: string, @Res() res: Response) {
    const sanitizedIcon = this.iconPathResolver.sanitizeIconName(icon);
    const filePath = path.resolve(
      this.generatedIconsPath,
      `${sanitizedIcon}.png`,
    );
    if (!filePath.startsWith(this.generatedIconsPathNormalized)) {
      throw new NotFoundException("Invalid generated icon path");
    }
    try {
      await fs.access(filePath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(filePath);
    } catch {
      throw new NotFoundException(`Generated icon ${sanitizedIcon} not found`);
    }
  }

  @Get("raw/:icon")
  async getRawIcon(@Param("icon") icon: string, @Res() res: Response) {
    const sanitizedIcon = this.iconPathResolver.sanitizeIconName(icon);
    const filePath = path.resolve(this.rawIconsPath, `${sanitizedIcon}.png`);
    if (!filePath.startsWith(this.rawIconsPathNormalized)) {
      throw new NotFoundException("Invalid raw icon path");
    }
    try {
      await fs.access(filePath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(filePath);
    } catch {
      throw new NotFoundException(`Raw icon ${sanitizedIcon} not found`);
    }
  }

  @Get("raw-retouch/:icon")
  async getRawRetouchIcon(@Param("icon") icon: string, @Res() res: Response) {
    await this.sendLeafPng(
      localIconsLeafDir("All-raw-retouch"),
      icon,
      res,
      "Raw retouch icon",
    );
  }

  @Get("generated-retouch/:icon")
  async getGeneratedRetouchIcon(
    @Param("icon") icon: string,
    @Res() res: Response,
  ) {
    await this.sendLeafPng(
      localIconsLeafDir("All-512-retouch"),
      icon,
      res,
      "Generated retouch icon",
    );
  }

  private async sendLeafPng(
    dir: string,
    icon: string,
    res: Response,
    label: string,
  ): Promise<void> {
    const sanitizedIcon = this.iconPathResolver.sanitizeIconName(icon);
    const base = path.resolve(dir);
    const filePath = path.resolve(base, `${sanitizedIcon}.png`);
    const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
    if (!filePath.startsWith(prefix)) {
      throw new NotFoundException(`Invalid ${label} path`);
    }
    try {
      await fs.access(filePath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(filePath);
    } catch {
      throw new NotFoundException(`${label} ${sanitizedIcon} not found`);
    }
  }
}
