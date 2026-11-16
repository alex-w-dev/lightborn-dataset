import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { imgAssetKey, type ImgKind, type ImgSize } from '@l-fight/dataset';
import sharp from 'sharp';
import { S3Service } from '../s3/s3.service';

export type IconType = 'monster' | 'npc' | 'skill' | 'item' | 'chars';
export type IconVariant = 'icon' | 'preview' | 'original';

interface TypeConfig {
  iconSize: [number, number];
  previewSize?: [number, number];
}

const TYPE_CONFIG: Record<IconType, TypeConfig> = {
  monster: {
    iconSize: [64, 64],
    previewSize: [512, 512],
  },
  npc: {
    iconSize: [64, 64],
    previewSize: [512, 512],
  },
  skill: {
    iconSize: [64, 64],
  },
  item: {
    iconSize: [64, 64],
  },
  chars: {
    iconSize: [64, 64],
    previewSize: [512, 512],
  },
};

const TYPE_TO_IMG_KIND: Record<IconType, ImgKind> = {
  monster: 'monsters',
  npc: 'npcs',
  skill: 'skills',
  item: 'items',
  chars: 'chars',
};

function variantToSize(variant: IconVariant): ImgSize {
  if (variant === 'icon') return 64;
  if (variant === 'preview') return 512;
  return 'original';
}

/** Monster/npc: numeric template id → image id (`m0001` / `n0001`). */
export function resolveIconEntityId(
  type: IconType,
  id: string | number,
): string | number {
  if (typeof id === 'string') return id;
  if (type === 'monster') return `m${String(id).padStart(4, '0')}`;
  if (type === 'npc') return `n${String(id).padStart(4, '0')}`;
  return id;
}

function s3KeyRaw(
  type: IconType,
  variant: IconVariant,
  keyId: string | number,
): string {
  return imgAssetKey(TYPE_TO_IMG_KIND[type], keyId, variantToSize(variant));
}

function s3Key(
  type: IconType,
  variant: IconVariant,
  id: string | number,
): string {
  return s3KeyRaw(type, variant, resolveIconEntityId(type, id));
}

export function getIconS3Key(
  type: IconType,
  variant: IconVariant,
  id: string | number,
): string {
  return s3Key(type, variant, id);
}

@Injectable()
export class IconService {
  constructor(private readonly s3Service: S3Service) {}

  isConfigured(): boolean {
    return this.s3Service.isConfigured();
  }

  /**
   * Получить изображение из S3. Если по id нет — возвращаем 0.jpg из того же префикса.
   */
  async getImage(
    type: IconType,
    id: string | number,
    variant: IconVariant,
  ): Promise<Buffer | null> {
    if (!this.s3Service.isConfigured()) return null;
    const config = TYPE_CONFIG[type];
    if (variant === 'preview' && !config.previewSize) return null;

    const key = s3Key(type, variant, id);
    const buf = await this.s3Service.getFileBufferOrNull(key);
    if (buf) return buf;

    // Для id 0 не делаем повторный fallback-запрос на тот же ключ.
    if (id === 0 || id === '0') return null;
    const fallbackKey = key.replace(
      /\/[^/]+\/(64|512|original)\.jpg$/,
      '/0/$1.jpg',
    );
    return this.s3Service.getFileBufferOrNull(fallbackKey);
  }

  /**
   * Иконка: S3 (или 0.jpg).
   * Fallback на 0.jpg уже внутри getImage — не дублируем вызовы.
   */
  async getIcon(type: IconType, id: string | number): Promise<Buffer | null> {
    return this.getImage(type, id, 'icon');
  }

  /**
   * Превью: preview → icon с fallback на 0.jpg.
   */
  async getPreview(
    type: IconType,
    id: string | number,
  ): Promise<Buffer | null> {
    const config = TYPE_CONFIG[type];
    if (config.previewSize) {
      return (
        (await this.getImage(type, id, 'preview')) ?? this.getIcon(type, id)
      );
    }
    return this.getIcon(type, id);
  }

  async exists(
    type: IconType,
    id: string | number,
    variant: IconVariant = 'icon',
  ): Promise<boolean> {
    if (!this.s3Service.isConfigured()) return false;
    return this.s3Service.exists(s3Key(type, variant, id));
  }

  /**
   * Загрузка: icon / preview / original в S3.
   * Cache-Control: public, max-age=31536000, immutable (см. S3Service.uploadFile).
   */
  async upload(
    type: IconType,
    id: string | number,
    buffer: Buffer,
  ): Promise<void> {
    if (!this.s3Service.isConfigured()) {
      throw new InternalServerErrorException('S3 is not configured');
    }
    const config = TYPE_CONFIG[type];
    const jpegOpts = { quality: 90 };

    const tasks: Promise<unknown>[] = [];

    const iconBuf = await sharp(buffer)
      .resize(config.iconSize[0], config.iconSize[1], { fit: 'cover' })
      .jpeg(jpegOpts)
      .toBuffer();
    tasks.push(
      this.s3Service.uploadFile({
        key: s3Key(type, 'icon', id),
        body: iconBuf,
        contentType: 'image/jpeg',
      }),
    );

    if (config.previewSize) {
      const previewBuf = await sharp(buffer)
        .resize(config.previewSize[0], config.previewSize[1], { fit: 'cover' })
        .jpeg(jpegOpts)
        .toBuffer();
      tasks.push(
        this.s3Service.uploadFile({
          key: s3Key(type, 'preview', id),
          body: previewBuf,
          contentType: 'image/jpeg',
        }),
      );
    }

    const originalBuf = await sharp(buffer).jpeg(jpegOpts).toBuffer();
    tasks.push(
      this.s3Service.uploadFile({
        key: s3Key(type, 'original', id),
        body: originalBuf,
        contentType: 'image/jpeg',
      }),
    );

    await Promise.all(tasks);
  }
}
