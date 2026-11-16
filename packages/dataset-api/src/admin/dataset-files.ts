import { BadRequestException, NotFoundException } from "@nestjs/common";
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import { parseBackgroundsFile } from "@l-fight/dataset";
import { assetGeneratedFile } from "../paths";

/** Общие ассеты. */
export const ADMIN_ASSET_DATASET_FILES: Record<string, string> = {
  "monster-images": "monster-images.json",
  "npc-images": "npc-images.json",
  "item-icons": "item-icons.json",
  "skill-icons": "skill-icons.json",
  backgrounds: "backgrounds.json",
  "avatar-images": "avatar-images.json",
  "location-images": "location-images.json",
  "game-icons-rename-map": "game-icons-rename-map.json",
  sfx: "sfx.json",
  music: "music.json",
};

export const ADMIN_RAW_DATASET_FILES: Record<string, string> = {
  ...ADMIN_ASSET_DATASET_FILES,
};

export const ADMIN_WRITABLE_DATASET_RESOURCES = new Set<string>([
  "backgrounds",
  "avatar-images",
  "location-images",
  "sfx",
  "music",
]);

export function resolveDatasetFilePath(resource: string): string {
  const asset = ADMIN_ASSET_DATASET_FILES[resource];
  if (asset) return assetGeneratedFile(asset);
  throw new NotFoundException(`Unknown dataset resource: ${resource}`);
}

export function resolveGeneratedFileName(fileName: string): string {
  if (Object.values(ADMIN_ASSET_DATASET_FILES).includes(fileName)) {
    return assetGeneratedFile(fileName);
  }
  throw new NotFoundException(`Unknown dataset file: ${fileName}`);
}

export async function readGeneratedJson(fileName: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(resolveGeneratedFileName(fileName), "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof NotFoundException) throw error;
    throw new NotFoundException(`Dataset file not found: ${fileName}`);
  }
}

export async function writeGeneratedJson(
  fileName: string,
  body: unknown,
): Promise<void> {
  await fs.writeFile(
    resolveGeneratedFileName(fileName),
    `${JSON.stringify(body, null, 2)}\n`,
    "utf8",
  );
}

export function readGeneratedJsonSync(fileName: string): unknown {
  const raw = readFileSync(resolveGeneratedFileName(fileName), "utf8");
  return JSON.parse(raw) as unknown;
}

export function validateWritableBody(resource: string, body: unknown): unknown {
  if (resource === "backgrounds") {
    try {
      return parseBackgroundsFile(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid backgrounds",
      );
    }
  }
  return body;
}
