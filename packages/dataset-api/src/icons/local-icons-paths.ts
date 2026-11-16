import * as fs from 'fs';
import * as path from 'path';

export type LocalIconsLeaf =
  | 'All'
  | 'All-512'
  | 'All-512-new'
  | 'All-raw'
  | 'All-512-retouch'
  | 'All-raw-retouch';

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('repo root (pnpm-workspace.yaml) not found');
    }
    dir = parent;
  }
}

/** `local-assets/` в корне репозитория. Содержимое в .gitignore. */
export function localAssetsDir(): string {
  return path.join(findRepoRoot(__dirname), 'local-assets');
}

function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** `local-assets/icons/{leaf}` без создания каталога. */
export function localIconsLeafDir(leaf: LocalIconsLeaf): string {
  return path.join(localAssetsDir(), 'icons', leaf);
}

/** `local-assets/icons/{All|All-512|All-512-new|All-raw|All-512-retouch|All-raw-retouch}` */
export function defaultLocalIconsDir(leaf: LocalIconsLeaf): string {
  return ensureDir(localIconsLeafDir(leaf));
}

export function defaultMonsterOriginalsDir(): string {
  return ensureDir(path.join(localAssetsDir(), 'monsters'));
}

export function defaultMonsterGeneratedDir(): string {
  return ensureDir(path.join(localAssetsDir(), 'monsters-new'));
}

export function defaultNpcOriginalsDir(): string {
  return ensureDir(path.join(localAssetsDir(), 'npcs'));
}

export function defaultNpcGeneratedDir(): string {
  return ensureDir(path.join(localAssetsDir(), 'npcs-new'));
}

/** Рабочие JPG локаций + temp scale-flow (`{name} scaled/`). */
export function defaultMapLocsDir(): string {
  return ensureDir(path.join(localAssetsDir(), 'map', 'locs'));
}
