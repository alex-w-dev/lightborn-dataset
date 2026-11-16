import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';

export type SfxUploadFormat = 'ogg' | 'wav' | 'mp3';

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
