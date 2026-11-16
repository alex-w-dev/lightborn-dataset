import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { execFile, execFileSync } from 'child_process';
import { existsSync, readdirSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
  sfxAssetKey as sfxAssetObjectKey,
  sfxCatalogKey,
} from '@l-fight/dataset';
import { S3Service } from '../s3/s3.service';

const execFileAsync = promisify(execFile);

/** Имя файла без расширения: `sfx_ui_click` */
export const SFX_ID_RE = /^sfx_[a-z0-9_]+$/;

export const SFX_MAX_BYTES = 5 * 1024 * 1024;
/** Исходник с несколькими фразами для нарезки. */
export const SFX_PACK_MAX_BYTES = 25 * 1024 * 1024;

export const SFX_CATALOG_FILENAME = 'catalog.json';
export const SFX_S3_PREFIX = 'sfx/';
export const SFX_CATALOG_S3_KEY = sfxCatalogKey();

export function sfxS3Key(assetKey: string): string {
  return sfxAssetObjectKey(assetKey);
}

export type SfxUploadFormat = 'ogg' | 'wav' | 'mp3';

export type SfxCatalogFile = Record<string, number>;

export type SfxSliceSegment = {
  startSec: number;
  endSec: number;
  /** Множитель громкости относительно исходника (1 = 100%). */
  volume?: number;
};

/** Множитель громкости относительно исходника: 1 = 100%, 0.7 = 70%. */
export const SFX_VOLUME_MIN = 0.01;
export const SFX_VOLUME_MAX = 2;

/**
 * Парсит volume из form/body. `undefined`/`''` → 1.
 * Диапазон [SFX_VOLUME_MIN .. SFX_VOLUME_MAX].
 */
export function parseSfxVolumeFactor(
  raw: unknown,
  label = 'volume',
): number {
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`${label} must be a finite number`);
  }
  if (n < SFX_VOLUME_MIN || n > SFX_VOLUME_MAX) {
    throw new BadRequestException(
      `${label} must be in ${SFX_VOLUME_MIN}..${SFX_VOLUME_MAX} (got ${n})`,
    );
  }
  return n;
}

/** `sfx_foo` → 1; `sfx_foo_3` → { baseId: sfx_foo, variant: 3 }. */
export function parseSfxAssetKey(assetKey: string): {
  baseId: string;
  variant: number;
} {
  const key = String(assetKey ?? '').trim();
  const m = /^(.+)_([2-9]|[1-9]\d+)$/.exec(key);
  if (m) return { baseId: m[1], variant: Number(m[2]) };
  return { baseId: key, variant: 1 };
}

export function sfxAssetKey(baseId: string, variant: number): string {
  const v = Math.floor(variant);
  if (v <= 1) return baseId;
  return `${baseId}_${v}`;
}

export function assertSfxId(raw: string): string {
  const id = String(raw ?? '').trim();
  if (!SFX_ID_RE.test(id)) {
    throw new BadRequestException(
      `Invalid sfx id: ${raw}. Expected pattern sfx_<name>`,
    );
  }
  return id;
}

/** Определяет формат по magic bytes (приоритет) и расширению имени. */
export function detectSfxUploadFormat(
  originalName: string | undefined,
  buffer: Buffer,
): SfxUploadFormat | null {
  if (isOggMagic(buffer)) return 'ogg';
  if (isWavMagic(buffer)) return 'wav';
  if (isMp3Magic(buffer)) return 'mp3';

  const name = (originalName ?? '').toLowerCase();
  if (name.endsWith('.ogg')) return 'ogg';
  if (name.endsWith('.wav')) return 'wav';
  if (name.endsWith('.mp3')) return 'mp3';
  return null;
}

export function isOggMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  );
}

export function isWavMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  );
}

/** ID3 или MPEG frame sync. */
export function isMp3Magic(buffer: Buffer): boolean {
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') {
    return true;
  }
  if (buffer.length < 2) return false;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function ffmpegBinaryName(): string {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function tryWhichFfmpeg(): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where', ['ffmpeg'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const first = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      return first || null;
    }
    const out = execFileSync('which', ['ffmpeg'], {
      encoding: 'utf8',
    });
    const first = out.trim().split(/\r?\n/)[0];
    return first || null;
  } catch {
    return null;
  }
}

function tryWingetFfmpeg(): string | null {
  if (process.platform !== 'win32') return null;
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const root = path.join(local, 'Microsoft', 'WinGet', 'Packages');
  if (!existsSync(root)) return null;
  try {
    const pkgs = readdirSync(root).filter((n) =>
      n.toLowerCase().startsWith('gyan.ffmpeg'),
    );
    for (const pkg of pkgs.sort().reverse()) {
      const pkgDir = path.join(root, pkg);
      const builds = readdirSync(pkgDir).filter((n) =>
        n.toLowerCase().startsWith('ffmpeg-'),
      );
      for (const build of builds.sort().reverse()) {
        const candidate = path.join(pkgDir, build, 'bin', 'ffmpeg.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Путь к бинарнику ffmpeg (`FFMPEG_BIN` = файл или каталог, иначе PATH / WinGet). */
export function resolveFfmpegPath(): string {
  const fromEnv = process.env.FFMPEG_BIN?.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    const base = path.basename(resolved).toLowerCase();
    if (base === 'ffmpeg' || base === 'ffmpeg.exe') return resolved;
    return path.join(resolved, ffmpegBinaryName());
  }
  const fromPath = tryWhichFfmpeg();
  if (fromPath) return fromPath;
  const fromWinget = tryWingetFfmpeg();
  if (fromWinget) return fromWinget;
  return ffmpegBinaryName();
}

@Injectable()
export class SfxService {
  constructor(private readonly s3: S3Service) {}

  private requireS3(): void {
    if (!this.s3.isConfigured()) {
      throw new InternalServerErrorException('S3 is not configured');
    }
  }

  async readCatalog(): Promise<SfxCatalogFile> {
    this.requireS3();
    const buf = await this.s3.getFileBufferOrNull(SFX_CATALOG_S3_KEY);
    if (!buf) return {};
    try {
      const parsed = JSON.parse(buf.toString('utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      const out: SfxCatalogFile = {};
      for (const [id, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(n) && n >= 1) out[id] = Math.floor(n);
      }
      return out;
    } catch {
      return {};
    }
  }

  async writeCatalog(catalog: SfxCatalogFile): Promise<void> {
    this.requireS3();
    await this.s3.uploadFile({
      key: SFX_CATALOG_S3_KEY,
      body: Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8'),
      contentType: 'application/json',
    });
  }

  /** Для тестов / отладки. */
  async readSfxObject(assetKey: string): Promise<Buffer | null> {
    this.requireS3();
    return this.s3.getFileBufferOrNull(sfxS3Key(assertSfxId(assetKey)));
  }

  async replaceSfx(
    id: string,
    buffer: Buffer,
    originalName?: string,
  ): Promise<{
    id: string;
    key: string;
    bytes: number;
    format: SfxUploadFormat;
    converted: boolean;
  }> {
    this.requireS3();
    if (!buffer?.length) {
      throw new BadRequestException('File is required');
    }
    if (buffer.length > SFX_MAX_BYTES) {
      throw new BadRequestException(
        `File too large (max ${SFX_MAX_BYTES} bytes)`,
      );
    }

    const format = detectSfxUploadFormat(originalName, buffer);
    if (!format) {
      throw new BadRequestException(
        'Only .ogg, .wav or .mp3 audio files are allowed',
      );
    }
    if (format === 'ogg' && !isOggMagic(buffer)) {
      throw new BadRequestException(
        'File does not look like OGG (missing OggS header)',
      );
    }

    const safeId = assertSfxId(id);
    const key = sfxS3Key(safeId);

    try {
      let oggBuffer: Buffer;
      let converted = false;
      if (format === 'ogg') {
        oggBuffer = buffer;
      } else {
        oggBuffer = await this.convertToOgg(buffer, format);
        converted = true;
      }
      await this.s3.uploadFile({
        key,
        body: oggBuffer,
        contentType: 'audio/ogg',
      });
      return {
        id: safeId,
        key,
        bytes: oggBuffer.length,
        format,
        converted,
      };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(
        `Failed to write sfx file: ${message}`,
      );
    }
  }

  /**
   * Нарезка пачки: слоты startVariant..startVariant+N-1 (досоздаёт при необходимости).
   * Обновляет catalog.json.variants = max(current, lastWritten).
   */
  async replaceSfxSlices(params: {
    baseId: string;
    startVariant: number;
    buffer: Buffer;
    originalName?: string;
    segments: SfxSliceSegment[];
  }): Promise<{
    baseId: string;
    written: Array<{
      variant: number;
      assetKey: string;
      bytes: number;
      volume: number;
    }>;
    variants: number;
    format: SfxUploadFormat;
  }> {
    const { buffer, originalName } = params;
    const baseId = assertSfxId(params.baseId);
    const startVariant = Math.floor(Number(params.startVariant));
    if (!Number.isFinite(startVariant) || startVariant < 1) {
      throw new BadRequestException('startVariant must be >= 1');
    }
    if (!Array.isArray(params.segments) || params.segments.length === 0) {
      throw new BadRequestException('segments required');
    }
    if (!buffer?.length) {
      throw new BadRequestException('File is required');
    }
    if (buffer.length > SFX_PACK_MAX_BYTES) {
      throw new BadRequestException(
        `File too large (max ${SFX_PACK_MAX_BYTES} bytes)`,
      );
    }

    const segments: Array<{
      startSec: number;
      endSec: number;
      volume: number;
    }> = [];
    for (let i = 0; i < params.segments.length; i++) {
      const seg = params.segments[i];
      const start = Number(seg?.startSec);
      const end = Number(seg?.endSec);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new BadRequestException(`segment[${i}]: invalid times`);
      }
      if (start < 0 || end <= start) {
        throw new BadRequestException(
          `segment[${i}]: need 0 <= start < end (got ${start}..${end})`,
        );
      }
      segments.push({
        startSec: start,
        endSec: end,
        volume: parseSfxVolumeFactor(
          (seg as SfxSliceSegment)?.volume,
          `segment[${i}].volume`,
        ),
      });
    }

    const format = detectSfxUploadFormat(originalName, buffer);
    if (!format) {
      throw new BadRequestException(
        'Only .ogg, .wav or .mp3 audio files are allowed',
      );
    }
    if (format === 'ogg' && !isOggMagic(buffer)) {
      throw new BadRequestException(
        'File does not look like OGG (missing OggS header)',
      );
    }

    this.requireS3();
    const ffmpeg = resolveFfmpegPath();
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-sfx-pack-'));
    const srcPath = path.join(tmpRoot, `input.${format}`);
    const written: Array<{
      variant: number;
      assetKey: string;
      bytes: number;
      volume: number;
    }> = [];

    try {
      await fs.writeFile(srcPath, buffer);

      for (let i = 0; i < segments.length; i++) {
        const variant = startVariant + i;
        const assetKey = sfxAssetKey(baseId, variant);
        const target = path.join(tmpRoot, `${assetKey}.ogg`);
        const start = segments[i].startSec;
        const duration = segments[i].endSec - start;
        const volume = segments[i].volume;
        const args = [
          '-y',
          '-ss',
          String(start),
          '-i',
          srcPath,
          '-t',
          String(duration),
        ];
        if (volume !== 1) {
          args.push('-af', `volume=${volume}`);
        }
        args.push('-c:a', 'libvorbis', '-q:a', '5', target);
        try {
          await execFileAsync(ffmpeg, args, {
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
          });
        } catch (err) {
          this.throwFfmpegError(err, `slice variant ${variant}`);
        }
        const out = await fs.readFile(target);
        if (!isOggMagic(out)) {
          throw new InternalServerErrorException(
            `ffmpeg produced a non-OGG file for ${assetKey}`,
          );
        }
        await this.s3.uploadFile({
          key: sfxS3Key(assetKey),
          body: out,
          contentType: 'audio/ogg',
        });
        written.push({ variant, assetKey, bytes: out.length, volume });
      }
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }

    const lastVariant = startVariant + segments.length - 1;
    const catalog = await this.readCatalog();
    const prevRaw = catalog[baseId];
    const prevVariants =
      Number.isFinite(prevRaw) && prevRaw >= 1 ? Math.floor(prevRaw) : 1;
    catalog[baseId] = Math.max(prevVariants, lastVariant);
    await this.writeCatalog(catalog);

    return {
      baseId,
      written,
      variants: catalog[baseId],
      format,
    };
  }

  /**
   * Дублирует последний вариант (копия файла → N+1) и увеличивает catalog.
   * Модалку нарезки не открывает — новый слот затем заменяют через upload.
   */
  async duplicateLastSfxVariant(baseId: string): Promise<{
    baseId: string;
    fromVariant: number;
    fromAssetKey: string;
    toVariant: number;
    toAssetKey: string;
    variants: number;
    bytes: number;
  }> {
    this.requireS3();
    const id = assertSfxId(baseId);
    const catalog = await this.readCatalog();
    const prevRaw = catalog[id];
    const count =
      Number.isFinite(prevRaw) && prevRaw >= 1 ? Math.floor(prevRaw) : 1;

    const fromVariant = count;
    const toVariant = count + 1;
    const fromAssetKey = sfxAssetKey(id, fromVariant);
    const toAssetKey = sfxAssetKey(id, toVariant);

    const out = await this.s3.getFileBufferOrNull(sfxS3Key(fromAssetKey));
    if (!out) {
      throw new BadRequestException(
        `Source SFX file missing: ${fromAssetKey}.ogg`,
      );
    }
    if (!isOggMagic(out)) {
      throw new BadRequestException(
        `Source ${fromAssetKey}.ogg is not a valid OGG`,
      );
    }

    await this.s3.uploadFile({
      key: sfxS3Key(toAssetKey),
      body: out,
      contentType: 'audio/ogg',
    });

    catalog[id] = toVariant;
    await this.writeCatalog(catalog);

    return {
      baseId: id,
      fromVariant,
      fromAssetKey,
      toVariant,
      toAssetKey,
      variants: toVariant,
      bytes: out.length,
    };
  }

  /**
   * Удаляет вариант и сдвигает следующие на −1 (переименование файлов).
   * Минимум 1 вариант обязателен — удаление единственного запрещено.
   */
  async deleteSfxVariant(
    baseId: string,
    variant: number,
  ): Promise<{
    baseId: string;
    deletedVariant: number;
    variants: number;
    renamed: Array<{ from: string; to: string }>;
  }> {
    const id = assertSfxId(baseId);
    const v = Math.floor(Number(variant));
    if (!Number.isFinite(v) || v < 1) {
      throw new BadRequestException('variant must be >= 1');
    }

    const catalog = await this.readCatalog();
    const prevRaw = catalog[id];
    const count =
      Number.isFinite(prevRaw) && prevRaw >= 1 ? Math.floor(prevRaw) : 1;

    if (count <= 1) {
      throw new BadRequestException('Cannot delete the only SFX variant');
    }
    if (v > count) {
      throw new BadRequestException(
        `variant ${v} out of range (1..${count})`,
      );
    }

    this.requireS3();
    const deletedKey = sfxS3Key(sfxAssetKey(id, v));
    if (await this.s3.exists(deletedKey)) {
      await this.s3.deleteObject(deletedKey);
    }

    const renamed: Array<{ from: string; to: string }> = [];
    for (let from = v + 1; from <= count; from++) {
      const fromKey = sfxAssetKey(id, from);
      const toKey = sfxAssetKey(id, from - 1);
      const fromS3 = sfxS3Key(fromKey);
      const toS3 = sfxS3Key(toKey);
      const buf = await this.s3.getFileBufferOrNull(fromS3);
      if (!buf) continue;
      await this.s3.uploadFile({
        key: toS3,
        body: buf,
        contentType: 'audio/ogg',
      });
      await this.s3.deleteObject(fromS3);
      renamed.push({ from: fromKey, to: toKey });
    }

    catalog[id] = count - 1;
    await this.writeCatalog(catalog);

    return {
      baseId: id,
      deletedVariant: v,
      variants: catalog[id],
      renamed,
    };
  }

  private async convertToOgg(
    buffer: Buffer,
    format: Exclude<SfxUploadFormat, 'ogg'>,
  ): Promise<Buffer> {
    const ffmpeg = resolveFfmpegPath();
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-sfx-'));
    const srcPath = path.join(tmpRoot, `input.${format}`);
    const outPath = path.join(tmpRoot, 'out.ogg');
    try {
      await fs.writeFile(srcPath, buffer);
      try {
        await execFileAsync(
          ffmpeg,
          [
            '-y',
            '-i',
            srcPath,
            '-c:a',
            'libvorbis',
            '-q:a',
            '5',
            outPath,
          ],
          { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        );
      } catch (err) {
        this.throwFfmpegError(err, `convert ${format} → ogg`);
      }

      const out = await fs.readFile(outPath);
      if (!isOggMagic(out)) {
        throw new InternalServerErrorException(
          'ffmpeg produced a non-OGG file',
        );
      }
      return out;
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private throwFfmpegError(err: unknown, context: string): never {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr?: Buffer | string }).stderr ?? '')
        : '';
    const message = err instanceof Error ? err.message : String(err);
    if (
      /ENOENT|not found|не найден/i.test(message) ||
      (err as NodeJS.ErrnoException)?.code === 'ENOENT'
    ) {
      throw new InternalServerErrorException(
        'ffmpeg not found. Install ffmpeg or set FFMPEG_BIN',
      );
    }
    throw new BadRequestException(
      `Failed to ${context}: ${stderr.trim() || message}`,
    );
  }

}
