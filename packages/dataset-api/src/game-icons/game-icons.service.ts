import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  gameIconCatalogFileName,
  gameIconImgKind,
  imgAssetKey,
  type GameIconImage,
} from '@l-fight/dataset';
import axios, { AxiosInstance } from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { IconPathResolver } from '../icons/icon-path.resolver';
import {
  defaultLocalIconsDir,
  localIconsLeafDir,
} from '../icons/local-icons-paths';
import { assetGeneratedFile } from '../paths';
import { S3Service } from '../s3/s3.service';

interface SdResponse {
  images?: string[];
  image?: string;
}

const DEFAULT_ICON_UPSCALER = 'R-ESRGAN 4x+';
const TARGET_ICON_SIZE = 512;

type IconWorkflowFlag =
  | 'pendingS3Sync'
  | 'needLocalUpdate'
  | 'retouchPendingS3Sync'
  | 'retouchNeedLocalUpdate'
  | 'retouchUpdatedLocally'
  | 'retouchUpdatedInS3';

const ICON_CATALOG_FILES = [
  'item-icons.json',
  'skill-icons.json',
] as const;


interface ApplyIconParams {
  icon: string;
  image512Base64?: string;
}

interface FromClipboardParams {
  icon: string;
  imageBase64: string;
}

export type GameIconLocalTransformOp = 'flipHorizontal' | 'rotate180';

@Injectable()
export class GameIconsService {
  private readonly preparedIcons512Path: string;
  private readonly generatedIcons512Path: string;
  /** Сырые картинки до кропа: `local-assets/icons/All-raw`. */
  private readonly rawIconsPath: string;
  /** Доработка иконок: буфер отдельно от All-raw. */
  private readonly retouchRawIconsPath: string;
  /** Доработка иконок: 512 отдельно от All-512-new. */
  private readonly retouchGeneratedIcons512Path: string;
  private readonly sdClient: AxiosInstance;
  private readonly iconUpscaler: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly iconPathResolver: IconPathResolver,
    private readonly s3Service: S3Service,
  ) {
    this.preparedIcons512Path = this.readPreparedIconsPath();
    this.generatedIcons512Path = this.readGeneratedIconsPath();
    this.rawIconsPath = this.readRawIconsPath();
    this.retouchRawIconsPath = this.readRetouchRawIconsPath();
    this.retouchGeneratedIcons512Path = this.readRetouchGeneratedIconsPath();
    this.iconUpscaler =
      this.readString('SD_ICON_UPSCALER') ?? DEFAULT_ICON_UPSCALER;
    // URL нужен для extras-upscale при вставке из буфера; без env API поднимается.
    const stableUrl =
      this.readString('STABLE_DIFFUSSION_URL') ?? 'http://127.0.0.1:7860';
    this.sdClient = axios.create({
      baseURL: `${stableUrl}/sdapi/v1`,
      timeout: 180_000,
    });
  }

  async fromClipboard(params: FromClipboardParams): Promise<{
    source: 'clipboard';
    image512Base64: string;
    image64Base64: string;
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(params.icon);
    const sourceBuffer = this.decodeBase64(params.imageBase64);
    return this.commitSquareTo512(icon, sourceBuffer);
  }

  /** Сырой PNG в All-raw: без кропа, без 512 и без pending. */
  async saveRaw(params: FromClipboardParams): Promise<{
    ok: true;
    icon: string;
    width: number;
    height: number;
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(params.icon);
    const sourceBuffer = this.decodeBase64(params.imageBase64);
    let png: Buffer;
    try {
      png = await sharp(sourceBuffer).png().toBuffer();
    } catch {
      throw new BadRequestException('Raw image is not a valid image');
    }
    const meta = await sharp(png).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1) {
      throw new BadRequestException('Raw image has invalid dimensions');
    }
    const localPath = this.rawIconFilePath(icon);
    await this.ensureRawIconsDir();
    await fs.writeFile(localPath, png);
    return { ok: true, icon, width, height, localPath };
  }

  /** All-raw → центр-квадрат и та же запись 512 + pending, что fromClipboard. */
  async applyRawAsIs(iconRaw: string): Promise<{
    source: 'clipboard';
    image512Base64: string;
    image64Base64: string;
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    const raw = await this.readRawIconBufferOrNull(icon);
    if (!raw) {
      throw new NotFoundException(`Raw icon ${icon} not found`);
    }
    return this.commitSquareTo512(icon, raw);
  }

  /**
   * Зеркало / поворот 180° для локальных файлов иконки:
   * All-raw (если есть) и All-512-new (если есть).
   * При изменении 512 — отметка pending-s3-sync.
   */
  async transformLocal(
    iconRaw: string,
    op: GameIconLocalTransformOp,
  ): Promise<{
    ok: true;
    icon: string;
    op: GameIconLocalTransformOp;
    transformedRaw: boolean;
    transformed512: boolean;
    image512Base64: string | null;
    image64Base64: string | null;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    if (op !== 'flipHorizontal' && op !== 'rotate180') {
      throw new BadRequestException(
        'Transform op must be flipHorizontal or rotate180',
      );
    }

    const rawPath = this.rawIconFilePath(icon);
    const generatedPath = path.resolve(
      this.generatedIcons512Path,
      `${icon}.png`,
    );
    const rawBuf = await this.readRawIconBufferOrNull(icon);
    let generatedBuf: Buffer | null = null;
    try {
      generatedBuf = await fs.readFile(generatedPath);
    } catch {
      generatedBuf = null;
    }

    if (!rawBuf && !generatedBuf) {
      throw new NotFoundException(
        `No local raw or 512 icon found for ${icon}`,
      );
    }

    let transformedRaw = false;
    let transformed512 = false;
    let image512Base64: string | null = null;
    let image64Base64: string | null = null;

    if (rawBuf) {
      const nextRaw = await this.applyImageTransform(rawBuf, op);
      await this.ensureRawIconsDir();
      await fs.writeFile(rawPath, nextRaw);
      transformedRaw = true;
    }

    if (generatedBuf) {
      const next512 = await this.applyImageTransform(generatedBuf, op);
      await this.ensureGeneratedIconsDir();
      await fs.writeFile(generatedPath, next512);
      await this.markPendingSync(icon);
      transformed512 = true;
      image512Base64 = next512.toString('base64');
      const preview64Buffer = await sharp(next512)
        .resize(64, 64, { fit: 'cover' })
        .jpeg({ quality: 90 })
        .toBuffer();
      image64Base64 = preview64Buffer.toString('base64');
    }

    return {
      ok: true,
      icon,
      op,
      transformedRaw,
      transformed512,
      image512Base64,
      image64Base64,
    };
  }

  /**
   * Зеркало / поворот 180° для доработки:
   * All-raw-retouch и All-512-retouch. Старые All-raw и All-512-new не трогает.
   * При изменении 512 — pending и updated-locally доработки.
   */
  async transformRetouchLocal(
    iconRaw: string,
    op: GameIconLocalTransformOp,
  ): Promise<{
    ok: true;
    icon: string;
    op: GameIconLocalTransformOp;
    transformedRaw: boolean;
    transformed512: boolean;
    image512Base64: string | null;
    image64Base64: string | null;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    if (op !== 'flipHorizontal' && op !== 'rotate180') {
      throw new BadRequestException(
        'Transform op must be flipHorizontal or rotate180',
      );
    }

    const generatedPath = path.resolve(
      this.retouchGeneratedIcons512Path,
      `${icon}.png`,
    );
    const rawBuf = await this.readRetouchRawIconBufferOrNull(icon);
    let generatedBuf: Buffer | null = null;
    try {
      generatedBuf = await fs.readFile(generatedPath);
    } catch {
      generatedBuf = null;
    }

    if (!rawBuf && !generatedBuf) {
      throw new NotFoundException(
        `No local retouch raw or 512 icon found for ${icon}`,
      );
    }

    let transformedRaw = false;
    let transformed512 = false;
    let image512Base64: string | null = null;
    let image64Base64: string | null = null;

    if (rawBuf) {
      const nextRaw = await this.applyImageTransform(rawBuf, op);
      await this.ensureRetouchRawIconsDir();
      await fs.writeFile(this.retouchRawIconFilePath(icon), nextRaw);
      transformedRaw = true;
    }

    if (generatedBuf) {
      const next512 = await this.applyImageTransform(generatedBuf, op);
      await this.ensureRetouchGeneratedIconsDir();
      await fs.writeFile(generatedPath, next512);
      await this.markRetouchPendingSync(icon);
      transformed512 = true;
      image512Base64 = next512.toString('base64');
      const preview64Buffer = await sharp(next512)
        .resize(64, 64, { fit: 'cover' })
        .jpeg({ quality: 90 })
        .toBuffer();
      image64Base64 = preview64Buffer.toString('base64');
    }

    return {
      ok: true,
      icon,
      op,
      transformedRaw,
      transformed512,
      image512Base64,
      image64Base64,
    };
  }

  private async applyImageTransform(
    source: Buffer,
    op: GameIconLocalTransformOp,
  ): Promise<Buffer> {
    try {
      let pipeline = sharp(source);
      if (op === 'flipHorizontal') {
        pipeline = pipeline.flop();
      } else {
        pipeline = pipeline.rotate(180);
      }
      return await pipeline.png().toBuffer();
    } catch {
      throw new BadRequestException('Local icon is not a valid image');
    }
  }

  /**
   * Восстановить локальный визуал из S3 512: записать в All-raw и All-512-new.
   * JSON (pending / need-local-update) не трогает.
   */
  async restoreFromS3(iconRaw: string): Promise<{
    ok: true;
    icon: string;
    image512Base64: string;
    image64Base64: string;
    rawPath: string;
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const key512 = imgAssetKey(gameIconImgKind(icon), icon, 512);
    const s3Buffer = await this.s3Service.getFileBufferOrNull(key512);
    if (!s3Buffer) {
      throw new NotFoundException(`S3 icon not found: ${key512}`);
    }

    let png512: Buffer;
    try {
      png512 = await sharp(s3Buffer)
        .resize(TARGET_ICON_SIZE, TARGET_ICON_SIZE, { fit: 'cover' })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException('S3 image is not a valid image');
    }

    const rawPath = this.rawIconFilePath(icon);
    await this.ensureRawIconsDir();
    await fs.writeFile(rawPath, png512);

    const localPath = path.resolve(this.generatedIcons512Path, `${icon}.png`);
    await this.ensureGeneratedIconsDir();
    await fs.writeFile(localPath, png512);

    const preview64Buffer = await sharp(png512)
      .resize(64, 64, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();

    return {
      ok: true,
      icon,
      image512Base64: png512.toString('base64'),
      image64Base64: preview64Buffer.toString('base64'),
      rawPath,
      localPath,
    };
  }

  /**
   * Байты `img/{items|skills}/{icon}/512.jpg` из S3. На диск не пишет.
   */
  async readS3Source(iconRaw: string): Promise<{
    icon: string;
    imageBase64: string;
    mime: 'image/jpeg';
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const key512 = imgAssetKey(gameIconImgKind(icon), icon, 512);
    const s3Buffer = await this.s3Service.getFileBufferOrNull(key512);
    if (!s3Buffer) {
      throw new NotFoundException(`S3 icon not found: ${key512}`);
    }
    return {
      icon,
      imageBase64: s3Buffer.toString('base64'),
      mime: 'image/jpeg',
    };
  }

  /** Сырой PNG в All-raw-retouch. All-raw не трогает. */
  async saveRetouchRaw(params: FromClipboardParams): Promise<{
    ok: true;
    icon: string;
    width: number;
    height: number;
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(params.icon);
    const sourceBuffer = this.decodeBase64(params.imageBase64);
    let png: Buffer;
    try {
      png = await sharp(sourceBuffer).png().toBuffer();
    } catch {
      throw new BadRequestException('Raw image is not a valid image');
    }
    const meta = await sharp(png).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1) {
      throw new BadRequestException('Raw image has invalid dimensions');
    }
    const localPath = this.retouchRawIconFilePath(icon);
    await this.ensureRetouchRawIconsDir();
    await fs.writeFile(localPath, png);
    return { ok: true, icon, width, height, localPath };
  }

  /** All-raw-retouch → 512 в All-512-retouch и свой pending. */
  async applyRetouchRaw(iconRaw: string): Promise<{
    source: 'clipboard';
    image512Base64: string;
    image64Base64: string;
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    const raw = await this.readRetouchRawIconBufferOrNull(icon);
    if (!raw) {
      throw new NotFoundException(`Retouch raw icon ${icon} not found`);
    }
    return this.commitRetouchSquareTo512(icon, raw);
  }

  /** Кроп с клиента → 512 в All-512-retouch. All-512-new не трогает. */
  async fromRetouchClipboard(params: FromClipboardParams): Promise<{
    source: 'clipboard';
    image512Base64: string;
    image64Base64: string;
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(params.icon);
    const sourceBuffer = this.decodeBase64(params.imageBase64);
    return this.commitRetouchSquareTo512(icon, sourceBuffer);
  }

  async listRetouchRaw(): Promise<{ icons: string[] }> {
    return this.listPngIconsInDir(this.retouchRawIconsPath);
  }

  async listRetouchPendingSync(): Promise<{ icons: string[] }> {
    return { icons: await this.readRetouchPendingSyncIcons() };
  }

  async listRetouchNeedLocalUpdate(): Promise<{ icons: string[] }> {
    return { icons: await this.readRetouchNeedLocalUpdateIcons() };
  }

  async listRetouchUpdatedLocally(): Promise<{ icons: string[] }> {
    return { icons: await this.readRetouchUpdatedLocallyIcons() };
  }

  async listRetouchUpdatedInS3(): Promise<{ icons: string[] }> {
    return { icons: await this.readRetouchUpdatedInS3Icons() };
  }

  async clearRetouchPendingSyncIcon(iconRaw: string): Promise<{
    ok: true;
    icon: string;
    icons: string[];
    updatedLocallyIcons: string[];
    updatedInS3Icons: string[];
    deletedLocal: boolean;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const deletedLocal = await this.deleteRetouchGeneratedLocalIcon(icon);
    await this.clearRetouchPendingSync(icon);
    await this.clearRetouchUpdatedLocally(icon);
    return {
      ok: true,
      icon,
      icons: await this.readRetouchPendingSyncIcons(),
      updatedLocallyIcons: await this.readRetouchUpdatedLocallyIcons(),
      updatedInS3Icons: await this.readRetouchUpdatedInS3Icons(),
      deletedLocal,
    };
  }

  /** Sync в S3 из All-512-retouch. Старый pending и All-512-new не трогает. */
  async applyRetouch(params: ApplyIconParams): Promise<{
    ok: true;
    keys: string[];
    urls: string[];
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(params.icon);
    const localPath = path.resolve(
      this.retouchGeneratedIcons512Path,
      `${icon}.png`,
    );
    const generatedBuffer = params.image512Base64
      ? this.decodeBase64(params.image512Base64)
      : await this.readGeneratedIconOrThrow(localPath);

    if (params.image512Base64) {
      const generatedPng = await sharp(generatedBuffer).png().toBuffer();
      await this.ensureRetouchGeneratedIconsDir();
      await fs.writeFile(localPath, generatedPng);
    }
    const jpeg512 = await sharp(generatedBuffer)
      .jpeg({ quality: 90 })
      .toBuffer();
    const jpeg64 = await sharp(jpeg512)
      .resize(64, 64, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();

    const kind = gameIconImgKind(icon);
    const key512 = imgAssetKey(kind, icon, 512);
    const key64 = imgAssetKey(kind, icon, 64);
    const keyOriginal = imgAssetKey(kind, icon, 'original');
    const [uploaded512, uploaded64] = await Promise.all([
      this.s3Service.uploadFile({
        key: key512,
        body: jpeg512,
        contentType: 'image/jpeg',
      }),
      this.s3Service.uploadFile({
        key: key64,
        body: jpeg64,
        contentType: 'image/jpeg',
      }),
      this.s3Service.uploadFile({
        key: keyOriginal,
        body: jpeg512,
        contentType: 'image/jpeg',
      }),
    ]);

    await this.clearRetouchPendingSync(icon);
    await this.markRetouchUpdatedLocally(icon);
    await this.markRetouchUpdatedInS3(icon);

    return {
      ok: true,
      keys: [key512, key64],
      urls: [uploaded512.url, uploaded64.url].filter((url): url is string =>
        Boolean(url),
      ),
      localPath,
    };
  }

  async listRaw(): Promise<{ icons: string[] }> {
    let names: string[];
    try {
      names = await fs.readdir(this.rawIconsPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { icons: [] };
      throw error;
    }
    const icons = names
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .map((name) => name.replace(/\.png$/i, ''))
      .filter((name) => {
        try {
          return this.iconPathResolver.toS3SafeIconName(name) === name;
        } catch {
          return false;
        }
      })
      .sort();
    return { icons };
  }

  async deleteRaw(
    iconRaw: string,
  ): Promise<{ ok: true; icon: string; deleted: boolean }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    const localPath = this.rawIconFilePath(icon);
    try {
      await fs.unlink(localPath);
      return { ok: true, icon, deleted: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ok: true, icon, deleted: false };
      throw error;
    }
  }

  private async commitSquareTo512(
    icon: string,
    sourceBuffer: Buffer,
  ): Promise<{
    source: 'clipboard';
    image512Base64: string;
    image64Base64: string;
    localPath: string;
  }> {
    const meta = await sharp(sourceBuffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1) {
      throw new BadRequestException('Clipboard image has invalid dimensions');
    }

    const side = Math.min(width, height);
    let workingBuffer = await sharp(sourceBuffer)
      .extract({
        left: Math.floor((width - side) / 2),
        top: Math.floor((height - side) / 2),
        width: side,
        height: side,
      })
      .png()
      .toBuffer();

    if (side < TARGET_ICON_SIZE) {
      workingBuffer = await this.upscaleWithSdExtras(
        workingBuffer,
        TARGET_ICON_SIZE / side,
      );
    }

    const png512 = await sharp(workingBuffer)
      .resize(TARGET_ICON_SIZE, TARGET_ICON_SIZE, { fit: 'cover' })
      .png()
      .toBuffer();
    const localPath = path.resolve(this.generatedIcons512Path, `${icon}.png`);
    await this.ensureGeneratedIconsDir();
    await fs.writeFile(localPath, png512);
    await this.markPendingSync(icon);
    const preview64Buffer = await sharp(png512)
      .resize(64, 64, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();

    return {
      source: 'clipboard',
      image512Base64: png512.toString('base64'),
      image64Base64: preview64Buffer.toString('base64'),
      localPath,
    };
  }

  private rawIconFilePath(icon: string): string {
    const base = path.resolve(this.rawIconsPath);
    const filePath = path.resolve(base, `${icon}.png`);
    const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
    if (!filePath.startsWith(prefix)) {
      throw new BadRequestException('Invalid raw icon path');
    }
    return filePath;
  }

  private async readRawIconBufferOrNull(icon: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.rawIconFilePath(icon));
    } catch {
      return null;
    }
  }

  private retouchRawIconFilePath(icon: string): string {
    const base = path.resolve(this.retouchRawIconsPath);
    const filePath = path.resolve(base, `${icon}.png`);
    const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
    if (!filePath.startsWith(prefix)) {
      throw new BadRequestException('Invalid retouch raw icon path');
    }
    return filePath;
  }

  private async readRetouchRawIconBufferOrNull(
    icon: string,
  ): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.retouchRawIconFilePath(icon));
    } catch {
      return null;
    }
  }

  private async listPngIconsInDir(dir: string): Promise<{ icons: string[] }> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { icons: [] };
      throw error;
    }
    const icons = names
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .map((name) => name.replace(/\.png$/i, ''))
      .filter((name) => {
        try {
          return this.iconPathResolver.toS3SafeIconName(name) === name;
        } catch {
          return false;
        }
      })
      .sort();
    return { icons };
  }

  private async commitRetouchSquareTo512(
    icon: string,
    sourceBuffer: Buffer,
  ): Promise<{
    source: 'clipboard';
    image512Base64: string;
    image64Base64: string;
    localPath: string;
  }> {
    const meta = await sharp(sourceBuffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1) {
      throw new BadRequestException('Clipboard image has invalid dimensions');
    }

    const side = Math.min(width, height);
    let workingBuffer = await sharp(sourceBuffer)
      .extract({
        left: Math.floor((width - side) / 2),
        top: Math.floor((height - side) / 2),
        width: side,
        height: side,
      })
      .png()
      .toBuffer();

    if (side < TARGET_ICON_SIZE) {
      workingBuffer = await this.upscaleWithSdExtras(
        workingBuffer,
        TARGET_ICON_SIZE / side,
      );
    }

    const png512 = await sharp(workingBuffer)
      .resize(TARGET_ICON_SIZE, TARGET_ICON_SIZE, { fit: 'cover' })
      .png()
      .toBuffer();
    const localPath = path.resolve(
      this.retouchGeneratedIcons512Path,
      `${icon}.png`,
    );
    await this.ensureRetouchGeneratedIconsDir();
    await fs.writeFile(localPath, png512);
    await this.markRetouchPendingSync(icon);
    const preview64Buffer = await sharp(png512)
      .resize(64, 64, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();

    return {
      source: 'clipboard',
      image512Base64: png512.toString('base64'),
      image64Base64: preview64Buffer.toString('base64'),
      localPath,
    };
  }

  private async deleteRetouchGeneratedLocalIcon(icon: string): Promise<boolean> {
    const localPath = path.resolve(
      this.retouchGeneratedIcons512Path,
      `${icon}.png`,
    );
    try {
      await fs.unlink(localPath);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return false;
      throw e;
    }
  }

  private async readRetouchPendingSyncIcons(): Promise<string[]> {
    return this.listIconsWithFlag('retouchPendingS3Sync');
  }

  private async readRetouchNeedLocalUpdateIcons(): Promise<string[]> {
    return this.listIconsWithFlag('retouchNeedLocalUpdate');
  }

  private async markRetouchPendingSync(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'retouchPendingS3Sync', true);
    await this.markRetouchUpdatedLocally(icon);
  }

  private async clearRetouchPendingSync(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'retouchPendingS3Sync', false);
  }

  private async markRetouchNeedLocalUpdate(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'retouchNeedLocalUpdate', true);
  }

  private async clearRetouchNeedLocalUpdate(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'retouchNeedLocalUpdate', false);
  }

  private async readRetouchUpdatedLocallyIcons(): Promise<string[]> {
    return this.listIconsWithFlag('retouchUpdatedLocally');
  }

  private async readRetouchUpdatedInS3Icons(): Promise<string[]> {
    return this.listIconsWithFlag('retouchUpdatedInS3');
  }

  private async markRetouchUpdatedLocally(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'retouchUpdatedLocally', true);
  }

  private async clearRetouchUpdatedLocally(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'retouchUpdatedLocally', false);
  }

  private async markRetouchUpdatedInS3(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'retouchUpdatedInS3', true);
  }

  async listPendingSync(): Promise<{ icons: string[] }> {
    const icons = await this.readPendingSyncIcons();
    return { icons };
  }

  async listNeedLocalUpdate(): Promise<{ icons: string[] }> {
    const icons = await this.readNeedLocalUpdateIcons();
    return { icons };
  }

  /** Перезаписать флаг needLocalUpdate полным списком id. */
  async writeNeedLocalUpdateIconsList(
    iconsRaw: string[],
  ): Promise<{ ok: true; icons: string[] }> {
    const icons = [
      ...new Set(
        (iconsRaw ?? [])
          .map((icon) => {
            try {
              return this.iconPathResolver.toS3SafeIconName(String(icon ?? ''));
            } catch {
              return '';
            }
          })
          .map((icon) => icon.trim())
          .filter(Boolean),
      ),
    ].sort();
    await this.replaceFlagSet('needLocalUpdate', icons);
    return { ok: true, icons };
  }

  /**
   * Сбросить локальную подготовку иконки (даже после Sync в S3):
   * удалить PNG из All-512-new, снять pendingS3Sync,
   * поставить needLocalUpdate (снова в очередь на обработку).
   */
  async clearPendingSyncIcon(
    iconRaw: string,
  ): Promise<{
    ok: true;
    icon: string;
    icons: string[];
    needLocalUpdateIcons: string[];
    deletedLocal: boolean;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(iconRaw);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    const deletedLocal = await this.deleteGeneratedLocalIcon(icon);
    await this.clearPendingSync(icon);
    await this.markNeedLocalUpdate(icon);
    const icons = await this.readPendingSyncIcons();
    const needLocalUpdateIcons = await this.readNeedLocalUpdateIcons();
    return { ok: true, icon, icons, needLocalUpdateIcons, deletedLocal };
  }

  /** Удалить `{icon}.png` из All-512-new; false если файла не было. */
  private async deleteGeneratedLocalIcon(icon: string): Promise<boolean> {
    const localPath = path.resolve(this.generatedIcons512Path, `${icon}.png`);
    try {
      await fs.unlink(localPath);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return false;
      throw e;
    }
  }

  async apply(params: ApplyIconParams): Promise<{
    ok: true;
    keys: string[];
    urls: string[];
    localPath: string;
  }> {
    const icon = this.iconPathResolver.toS3SafeIconName(params.icon);
    const localPath = path.resolve(this.generatedIcons512Path, `${icon}.png`);
    const generatedBuffer = params.image512Base64
      ? this.decodeBase64(params.image512Base64)
      : await this.readGeneratedIconOrThrow(localPath);

    if (params.image512Base64) {
      const generatedPng = await sharp(generatedBuffer).png().toBuffer();
      await this.ensureGeneratedIconsDir();
      await fs.writeFile(localPath, generatedPng);
    }
    const jpeg512 = await sharp(generatedBuffer)
      .jpeg({ quality: 90 })
      .toBuffer();
    const jpeg64 = await sharp(jpeg512)
      .resize(64, 64, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();

    const kind = gameIconImgKind(icon);
    const key512 = imgAssetKey(kind, icon, 512);
    const key64 = imgAssetKey(kind, icon, 64);
    const keyOriginal = imgAssetKey(kind, icon, 'original');
    const [uploaded512, uploaded64] = await Promise.all([
      this.s3Service.uploadFile({
        key: key512,
        body: jpeg512,
        contentType: 'image/jpeg',
      }),
      this.s3Service.uploadFile({
        key: key64,
        body: jpeg64,
        contentType: 'image/jpeg',
      }),
      this.s3Service.uploadFile({
        key: keyOriginal,
        body: jpeg512,
        contentType: 'image/jpeg',
      }),
    ]);

    await this.clearPendingSync(icon);
    await this.clearNeedLocalUpdate(icon);

    return {
      ok: true,
      keys: [key512, key64],
      urls: [uploaded512.url, uploaded64.url].filter((url): url is string =>
        Boolean(url),
      ),
      localPath,
    };
  }

  private async readLocalIconOrNull(icon: string): Promise<Buffer | null> {
    try {
      const localPath = path.resolve(this.preparedIcons512Path, `${icon}.png`);
      await fs.access(localPath);
      return await fs.readFile(localPath);
    } catch {
      return null;
    }
  }

  async getGeneratedIconBufferOrNull(icon: string): Promise<Buffer | null> {
    const safeIcon = this.iconPathResolver.toS3SafeIconName(icon);
    const localPath = path.resolve(
      this.generatedIcons512Path,
      `${safeIcon}.png`,
    );
    try {
      await fs.access(localPath);
      return await fs.readFile(localPath);
    } catch {
      return null;
    }
  }

  private async readGeneratedIconOrThrow(localPath: string): Promise<Buffer> {
    try {
      await fs.access(localPath);
      return await fs.readFile(localPath);
    } catch {
      throw new BadRequestException(
        `Generated icon not found in All-512-new: ${localPath}`,
      );
    }
  }

  private readPreparedIconsPath(): string {
    const customPath = this.configService.get<string>('ICONS_512_ROOT');
    if (customPath && customPath.trim()) {
      return path.resolve(customPath.trim());
    }
    return defaultLocalIconsDir('All-512');
  }

  private readGeneratedIconsPath(): string {
    const customPath = this.configService.get<string>('ICONS_512_NEW_ROOT');
    if (customPath && customPath.trim()) {
      return path.resolve(customPath.trim());
    }
    return defaultLocalIconsDir('All-512-new');
  }

  private readRawIconsPath(): string {
    const customPath = this.configService.get<string>('ICONS_RAW_ROOT');
    if (customPath && customPath.trim()) {
      return path.resolve(customPath.trim());
    }
    return defaultLocalIconsDir('All-raw');
  }

  private readRetouchRawIconsPath(): string {
    const customPath = this.configService.get<string>('ICONS_RAW_RETOUCH_ROOT');
    if (customPath && customPath.trim()) {
      return path.resolve(customPath.trim());
    }
    return localIconsLeafDir('All-raw-retouch');
  }

  private readRetouchGeneratedIconsPath(): string {
    const customPath = this.configService.get<string>(
      'ICONS_512_RETOUCH_ROOT',
    );
    if (customPath && customPath.trim()) {
      return path.resolve(customPath.trim());
    }
    return localIconsLeafDir('All-512-retouch');
  }

  /**
   * Node на Windows при `recursive` и отсутствующем диске отвечает
   * `ENOENT: mkdir '\\?'` — подменяем это понятной ошибкой с реальным путём.
   */
  private async ensureGeneratedIconsDir(): Promise<void> {
    await this.ensureIconsDir(
      this.generatedIcons512Path,
      'Каталог иконок недоступен',
    );
  }

  private async ensureRawIconsDir(): Promise<void> {
    await this.ensureIconsDir(this.rawIconsPath, 'Каталог сырых иконок недоступен');
  }

  private async ensureRetouchRawIconsDir(): Promise<void> {
    await this.ensureIconsDir(
      this.retouchRawIconsPath,
      'Каталог сырых иконок доработки недоступен',
    );
  }

  private async ensureRetouchGeneratedIconsDir(): Promise<void> {
    await this.ensureIconsDir(
      this.retouchGeneratedIcons512Path,
      'Каталог 512 доработки недоступен',
    );
  }

  private async ensureIconsDir(dir: string, message: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EPERM' || code === 'EACCES') {
        throw new InternalServerErrorException(
          `${message}: ${dir}. Диск не подключён или путь не существует.`,
        );
      }
      throw error;
    }
  }

  private async readIconCatalog(
    fileName: (typeof ICON_CATALOG_FILES)[number],
  ): Promise<GameIconImage[]> {
    try {
      const raw = await fs.readFile(assetGeneratedFile(fileName), 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as GameIconImage[]) : [];
    } catch {
      return [];
    }
  }

  private async writeIconCatalog(
    fileName: (typeof ICON_CATALOG_FILES)[number],
    rows: GameIconImage[],
  ): Promise<void> {
    await fs.writeFile(
      assetGeneratedFile(fileName),
      `${JSON.stringify(rows, null, 2)}\n`,
      'utf-8',
    );
  }

  private async listIconsWithFlag(flag: IconWorkflowFlag): Promise<string[]> {
    const ids: string[] = [];
    for (const fileName of ICON_CATALOG_FILES) {
      const rows = await this.readIconCatalog(fileName);
      for (const row of rows) {
        const id = String(row?.id ?? '').trim();
        if (id && row[flag]) ids.push(id);
      }
    }
    return [...new Set(ids)].sort();
  }

  private async setIconFlag(
    icon: string,
    flag: IconWorkflowFlag,
    value: boolean,
  ): Promise<void> {
    const fileName = gameIconCatalogFileName(icon);
    const rows = await this.readIconCatalog(fileName);
    const idx = rows.findIndex((row) => String(row?.id ?? '').trim() === icon);
    if (idx < 0) {
      if (!value) return;
      rows.push({ id: icon, description: '', [flag]: true });
      rows.sort((a, b) =>
        String(a.id).localeCompare(String(b.id), 'en', { numeric: true }),
      );
      await this.writeIconCatalog(fileName, rows);
      return;
    }
    const row = rows[idx]!;
    if (value) {
      if (row[flag]) return;
      row[flag] = true;
    } else {
      if (!row[flag]) return;
      delete row[flag];
    }
    await this.writeIconCatalog(fileName, rows);
  }

  private async replaceFlagSet(
    flag: IconWorkflowFlag,
    icons: string[],
  ): Promise<void> {
    const want = new Set(icons);
    const byFile = new Map<
      (typeof ICON_CATALOG_FILES)[number],
      Set<string>
    >();
    for (const id of want) {
      const fileName = gameIconCatalogFileName(id);
      let bucket = byFile.get(fileName);
      if (!bucket) {
        bucket = new Set();
        byFile.set(fileName, bucket);
      }
      bucket.add(id);
    }
    for (const fileName of ICON_CATALOG_FILES) {
      const rows = await this.readIconCatalog(fileName);
      const target = byFile.get(fileName) ?? new Set<string>();
      let dirty = false;
      const seen = new Set<string>();
      for (const row of rows) {
        const id = String(row?.id ?? '').trim();
        if (!id) continue;
        seen.add(id);
        const should = target.has(id);
        if (should && !row[flag]) {
          row[flag] = true;
          dirty = true;
        } else if (!should && row[flag]) {
          delete row[flag];
          dirty = true;
        }
      }
      for (const id of target) {
        if (seen.has(id)) continue;
        rows.push({ id, description: '', [flag]: true });
        dirty = true;
      }
      if (dirty) {
        rows.sort((a, b) =>
          String(a.id).localeCompare(String(b.id), 'en', { numeric: true }),
        );
        await this.writeIconCatalog(fileName, rows);
      }
    }
  }

  async readPendingSyncIcons(): Promise<string[]> {
    return this.listIconsWithFlag('pendingS3Sync');
  }

  async readNeedLocalUpdateIcons(): Promise<string[]> {
    return this.listIconsWithFlag('needLocalUpdate');
  }

  private async markPendingSync(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'pendingS3Sync', true);
  }

  private async clearPendingSync(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'pendingS3Sync', false);
  }

  private async markNeedLocalUpdate(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'needLocalUpdate', true);
  }

  private async clearNeedLocalUpdate(icon: string): Promise<void> {
    await this.setIconFlag(icon, 'needLocalUpdate', false);
  }


  private decodeBase64(value: string): Buffer {
    const normalized = String(value ?? '')
      .trim()
      .replace(/^data:image\/\w+;base64,/, '');
    if (!normalized) {
      throw new BadRequestException('Image base64 payload is required');
    }
    try {
      return Buffer.from(normalized, 'base64');
    } catch {
      throw new BadRequestException('Invalid base64 image payload');
    }
  }





  private readString(name: string): string | undefined {
    const raw = this.configService.get<string>(name);
    const normalized = String(raw ?? '').trim();
    return normalized ? normalized : undefined;
  }





  private async upscaleWithSdExtras(
    sourcePng: Buffer,
    scaleFactor: number,
  ): Promise<Buffer> {
    const payload: Record<string, unknown> = {
      resize_mode: 0,
      show_extras_results: false,
      gfpgan_visibility: 0,
      codeformer_visibility: 0,
      codeformer_weight: 0,
      upscaling_resize: scaleFactor,
      upscaling_crop: true,
      upscaler_1: this.iconUpscaler,
      upscaler_2: 'None',
      extras_upscaler_2_visibility: 0,
      upscale_first: false,
      image: sourcePng.toString('base64'),
    };

    let data: SdResponse;
    try {
      const response = await this.sdClient.post<SdResponse>(
        '/extra-single-image',
        payload,
      );
      data = response.data;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Stable Diffusion request failed';
      throw new InternalServerErrorException(
        `Icon clipboard extras upscale failed: ${message}`,
      );
    }

    const imageBase64 =
      (typeof data?.image === 'string' && data.image) ||
      (typeof data?.images?.[0] === 'string' && data.images[0]) ||
      null;
    if (!imageBase64) {
      throw new InternalServerErrorException(
        'Stable Diffusion extras returned empty image payload',
      );
    }
    return this.decodeBase64(imageBase64);
  }
}
