import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommandInput,
  GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Публичные ассеты по прямой ссылке: максимальный практичный TTL (1 год) + immutable. */
const S3_UPLOAD_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Иначе ListObjects при мёртвом endpoint висит ~60с и блокирует вызывающий код. */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 5_000;

export interface UploadFileOptions {
  key: string;
  body: Buffer | Uint8Array | Blob | string;
  contentType?: string;
}

//
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>('S3_REGION') ?? 'ru-central1';
    const accessKeyId =
      this.configService.get<string>('S3_ACCESS_KEY_ID') ??
      this.configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey =
      this.configService.get<string>('S3_SECRET_ACCESS_KEY') ??
      this.configService.get<string>('S3_SECRET_KEY');
    const forcePathStyle =
      this.configService.get<string>('S3_FORCE_PATH_STYLE') === 'true';

    this.bucket = this.configService.get<string>('S3_BUCKET') ?? '';
    this.publicBaseUrl =
      this.configService.get<string>('S3_PUBLIC_BASE_URL') ?? undefined;

    if (!this.bucket) {
      this.logger.warn(
        'S3_BUCKET is not configured. S3Service will not be able to upload files.',
      );
    }

    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'S3 credentials are not fully configured. S3Service will not be able to authenticate.',
      );
    }

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined,
      requestHandler: {
        connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
        requestTimeout: S3_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      },
    });
  }

  isConfigured(): boolean {
    return !!this.bucket;
  }

  async getFileBufferOrNull(key: string): Promise<Buffer | null> {
    if (!this.bucket) return null;
    try {
      return await this.getFileBuffer(key);
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.bucket) return false;
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Публичный URL объекта (если задан S3_PUBLIC_BASE_URL). */
  getPublicUrl(key: string): string | undefined {
    if (!this.publicBaseUrl) return undefined;
    const normalized = key.replace(/^\//, '');
    const encoded = normalized
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${encoded}`;
  }

  /**
   * Список ключей с данным префиксом (без «папок»-маркеров).
   * Пагинирует ListObjectsV2 до конца.
   */
  async listKeys(prefix: string): Promise<string[]> {
    if (!this.bucket) {
      throw new Error('S3_BUCKET is not configured');
    }

    const normalized = prefix.replace(/^\//, '');
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: normalized,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of response.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith('/')) continue;
        keys.push(obj.Key);
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return keys;
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.bucket) {
      throw new Error('S3_BUCKET is not configured');
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async uploadFile(options: UploadFileOptions): Promise<{
    key: string;
    url?: string;
  }> {
    if (!this.bucket) {
      throw new Error('S3_BUCKET is not configured');
    }

    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: options.key,
      Body: options.body,
      ContentType: options.contentType,
      CacheControl: S3_UPLOAD_CACHE_CONTROL,
    };

    await this.client.send(new PutObjectCommand(params));

    return { key: options.key, url: this.getPublicUrl(options.key) };
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    if (!this.bucket) {
      throw new Error('S3_BUCKET is not configured');
    }

    const params: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
    };

    const response = await this.client.send(new GetObjectCommand(params));

    if (!response.Body) {
      throw new Error(`Empty body received for key: ${key}`);
    }

    // Response body in AWS SDK v3 is a Readable stream in Node.js
    const chunks: Buffer[] = [];
    const stream = response.Body as any;

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async getPresignedUrlForGet(
    key: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    if (!this.bucket) {
      throw new Error('S3_BUCKET is not configured');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
