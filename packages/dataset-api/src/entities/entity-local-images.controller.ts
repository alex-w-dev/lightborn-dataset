import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { IconService } from "../icons/icon.service";
import { AdminMonsterLocalImagesService } from "./monster-local-images.service";
import { AdminNpcLocalImagesService } from "./npc-local-images.service";

@Controller("admin")
export class EntityLocalImagesController {
  constructor(
    private readonly monsters: AdminMonsterLocalImagesService,
    private readonly npcs: AdminNpcLocalImagesService,
    private readonly iconService: IconService,
  ) {}

  @Get("monsters/original-screenshot/:id")
  async getMonsterOriginalScreenshot(
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const file = await this.monsters.getOriginalScreenshotOrNull(id);
    if (!file) {
      throw new NotFoundException(`Original monster screenshot ${id} not found`);
    }
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(file.buffer);
  }

  @Get("monsters/local-image/:id")
  async getMonsterLocalImage(
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const file = await this.monsters.getLocalImageBufferOrNull(id);
    if (!file) {
      throw new NotFoundException(`Local monster image ${id} not found`);
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(file);
  }

  @Post("monsters/local-generate")
  generateMonsterLocal(
    @Body()
    body: {
      id?: number;
      prompt?: string;
      negativePrompt?: string;
    },
  ) {
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestException("id is required");
    }
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) {
      throw new BadRequestException("Prompt is required");
    }
    return this.monsters.generateTxt2Img1024({
      id,
      prompt,
      negativePrompt: body.negativePrompt,
    });
  }

  @Post("monsters/local-sync")
  syncMonsterLocal(@Body() body: { id?: number }) {
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestException("id is required");
    }
    return this.monsters.syncLocalToS3(id);
  }

  @Post("monsters/s3-presence")
  async getMonsterS3Presence(@Body() body: { ids?: number[] }) {
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map((id) => Number(id)).filter(Number.isInteger))]
      : [];
    const entries = await Promise.all(
      ids.map(
        async (id) =>
          [id, await this.iconService.exists("monster", id, "icon")] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  @Get("npcs/original-screenshot/:id")
  async getNpcOriginalScreenshot(
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const file = await this.npcs.getOriginalScreenshotOrNull(id);
    if (!file) {
      throw new NotFoundException(`Original NPC screenshot ${id} not found`);
    }
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(file.buffer);
  }

  @Get("npcs/local-image/:id")
  async getNpcLocalImage(
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const file = await this.npcs.getLocalImageBufferOrNull(id);
    if (!file) {
      throw new NotFoundException(`Local NPC image ${id} not found`);
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(file);
  }

  @Post("npcs/local-generate")
  generateNpcLocal(
    @Body()
    body: {
      id?: number;
      prompt?: string;
      negativePrompt?: string;
    },
  ) {
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestException("id is required");
    }
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) {
      throw new BadRequestException("Prompt is required");
    }
    return this.npcs.generateTxt2Img1024({
      id,
      prompt,
      negativePrompt: body.negativePrompt,
    });
  }

  @Post("npcs/local-sync")
  syncNpcLocal(@Body() body: { id?: number }) {
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestException("id is required");
    }
    return this.npcs.syncLocalToS3(id);
  }

  @Post("npcs/s3-presence")
  async getNpcS3Presence(@Body() body: { ids?: number[] }) {
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map((id) => Number(id)).filter(Number.isInteger))]
      : [];
    const entries = await Promise.all(
      ids.map(
        async (id) =>
          [id, await this.iconService.exists("npc", id, "icon")] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
}
