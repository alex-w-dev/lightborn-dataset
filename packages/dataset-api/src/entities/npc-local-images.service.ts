import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { IconService } from '../icons/icon.service';
import {
  defaultNpcGeneratedDir,
  defaultNpcOriginalsDir,
} from '../icons/local-icons-paths';

interface SdResponse {
  images?: string[];
}

const DEFAULT_NPC_SD_SAMPLER = 'DPM++ 2M Karras';
const DEFAULT_NPC_SD_STEPS = 35;
const DEFAULT_NPC_SD_CFG_SCALE = 6;
const DEFAULT_NPC_SD_NEGATIVE_PROMPT =
  'photorealistic, photography, photo, photograph, realistic, hyperrealistic, dslr, cinematic photo, camera, 35mm, bokeh, depth of field, raw photo, instagram, skin pores, film grain, realistic skin texture, 8k photo, selfie, 3d render, cgi, blurry, low quality, watermark, text, extra limbs, deformed hands, cropped';

@Injectable()
export class AdminNpcLocalImagesService {
  private readonly originalScreenshotsDir: string | null;
  private readonly localImagesDir: string;
  private readonly sdClient: AxiosInstance;
  private readonly sdSteps: number;
  private readonly sdCfgScale: number;
  private readonly sdSamplerName?: string;
  private readonly sdModelCheckpoint?: string;
  private readonly sdNegativePrompt: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly iconService: IconService,
  ) {
    this.originalScreenshotsDir = this.readOptionalDir(
      'NPC_ORIGINAL_SCREENSHOTS_DIR',
      () => defaultNpcOriginalsDir(),
    );
    this.localImagesDir = this.readRequiredDir('NPC_LOCAL_IMAGES_DIR', () =>
      defaultNpcGeneratedDir(),
    );
    const stableUrl = this.requireStableDiffusionUrl();
    this.sdClient = axios.create({
      baseURL: `${stableUrl}/sdapi/v1`,
      timeout: 180_000,
    });
    this.sdSteps = this.readNumber('SD_NPC_STEPS', DEFAULT_NPC_SD_STEPS);
    this.sdCfgScale = this.readNumber(
      'SD_NPC_CFG_SCALE',
      DEFAULT_NPC_SD_CFG_SCALE,
    );
    this.sdSamplerName =
      this.readString('SD_NPC_SAMPLER_NAME') ?? DEFAULT_NPC_SD_SAMPLER;
    this.sdModelCheckpoint =
      this.readString('SD_NPC_MODEL_CHECKPOINT') ??
      this.readString('SD_MODEL_CHECKPOINT');
    this.sdNegativePrompt =
      this.readString('SD_NPC_NEGATIVE_PROMPT') ??
      DEFAULT_NPC_SD_NEGATIVE_PROMPT;
  }

  async getLocalImageBufferOrNull(id: number): Promise<Buffer | null> {
    this.assertPositiveNpcId(id);
    const filePath = path.join(this.localImagesDir, `${id}.png`);
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async getOriginalScreenshotOrNull(
    id: number,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    this.assertPositiveNpcId(id);
    if (!this.originalScreenshotsDir) {
      return null;
    }
    const extensions = ['.png', '.jpg', '.jpeg', '.webp'] as const;
    for (const ext of extensions) {
      const filePath = path.join(this.originalScreenshotsDir, `${id}${ext}`);
      try {
        const buffer = await fs.readFile(filePath);
        const contentType =
          ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
        return { buffer, contentType };
      } catch {
        // try next extension
      }
    }
    return null;
  }

  async generateTxt2Img1024(params: {
    id: number;
    prompt: string;
    negativePrompt?: string;
  }): Promise<{ ok: true; source: 'txt2img' }> {
    const id = params.id;
    this.assertPositiveNpcId(id);
    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }
    const effectiveNegative =
      String(params.negativePrompt ?? '').trim() || this.sdNegativePrompt;

    const payload: Record<string, unknown> = {
      prompt,
      width: 1024,
      height: 1024,
      steps: this.sdSteps,
      cfg_scale: this.sdCfgScale,
      sampler_name: this.sdSamplerName,
      enable_hr: false,
    };
    if (effectiveNegative) {
      payload.negative_prompt = effectiveNegative;
    }
    if (this.sdModelCheckpoint) {
      payload.override_settings = {
        sd_model_checkpoint: this.sdModelCheckpoint,
      };
    }

    const { data } = await this.sdClient.post<SdResponse>('/txt2img', payload);
    const imageBase64 = data?.images?.[0];
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new InternalServerErrorException(
        'Stable Diffusion returned empty image payload',
      );
    }
    const normalized = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const rawBuffer = Buffer.from(normalized, 'base64');
    const pngBuffer = await sharp(rawBuffer).png().toBuffer();

    await fs.mkdir(this.localImagesDir, { recursive: true });
    const outPath = path.join(this.localImagesDir, `${id}.png`);
    await fs.writeFile(outPath, pngBuffer);

    return { ok: true, source: 'txt2img' };
  }

  async syncLocalToS3(id: number): Promise<{ ok: true }> {
    this.assertPositiveNpcId(id);
    const buf = await this.getLocalImageBufferOrNull(id);
    if (!buf) {
      throw new NotFoundException(`Local NPC image ${id}.png not found`);
    }
    await this.iconService.upload('npc', id, buf);
    return { ok: true };
  }

  private assertPositiveNpcId(id: number): void {
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('NPC id must be a positive integer');
    }
  }

  private readOptionalDir(
    envName: string,
    defaultPath: () => string,
  ): string | null {
    const raw = this.configService.get<string>(envName);
    if (raw !== undefined && String(raw).trim() === '') {
      return null;
    }
    const custom = raw?.trim();
    if (custom) {
      return path.resolve(custom);
    }
    return path.resolve(defaultPath());
  }

  private readRequiredDir(envName: string, defaultPath: () => string): string {
    const raw = this.configService.get<string>(envName);
    const custom = raw?.trim();
    if (custom) {
      return path.resolve(custom);
    }
    return path.resolve(defaultPath());
  }

  private requireStableDiffusionUrl(): string {
    const raw = this.configService.get<string>('STABLE_DIFFUSSION_URL');
    const normalized = String(raw ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (!normalized) {
      throw new InternalServerErrorException(
        'STABLE_DIFFUSSION_URL is not configured',
      );
    }
    return normalized;
  }

  private readNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string>(name);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private readString(name: string): string | undefined {
    const raw = this.configService.get<string>(name);
    const normalized = String(raw ?? '').trim();
    return normalized ? normalized : undefined;
  }
}
