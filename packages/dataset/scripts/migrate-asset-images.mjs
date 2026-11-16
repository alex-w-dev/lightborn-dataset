/**
 * Миграция: monster/npc → image-каталоги + поле image;
 * seed item-icons.json / skill-icons.json; удаление monster-appearance.json.
 *
 * S3 rename: лучше `pnpm --filter @l-fight/lightborn-api s3:rename-monster-npc-images -- --apply`
 * (или MIGRATE_S3=1 здесь — медленный per-key путь).
 *
 * Usage: node packages/dataset/scripts/migrate-asset-images.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.resolve(__dirname, "../src/generated");

function padImageId(prefix, id) {
  return `${prefix}${String(id).padStart(4, "0")}`;
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(generatedDir, fileName), "utf8"));
}

function writeJson(fileName, data) {
  const filePath = path.join(generatedDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`wrote ${fileName} (${Array.isArray(data) ? data.length : "object"})`);
}

function uniqueSortedIconRefs(items, skills) {
  const set = new Set();
  for (const item of items) {
    const icon = String(item.icon ?? "").trim();
    if (icon) set.add(icon);
  }
  for (const skill of skills) {
    const top = String(skill?.sets?.icon ?? "").trim();
    if (top) set.add(top);
    for (const table of skill.tables ?? []) {
      if (!Array.isArray(table) || table[0] !== "#icons") continue;
      for (let i = 1; i < table.length; i++) {
        const ref = String(table[i] ?? "").trim();
        if (ref) set.add(ref);
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "en"));
}

async function tryBuildIconDescriptions(iconIds, items, skills, renameMap) {
  try {
    const shared = await import("@l-fight/dataset");
    const build =
      shared.buildGameIconSuggestedPrompt ??
      shared.default?.buildGameIconSuggestedPrompt;
    if (typeof build !== "function") {
      console.warn("buildGameIconSuggestedPrompt not found; empty descriptions");
      return Object.fromEntries(iconIds.map((id) => [id, ""]));
    }
    const out = {};
    for (const id of iconIds) {
      try {
        out[id] = build(id, skills, items, renameMap) || "";
      } catch (err) {
        console.warn(`prompt failed for ${id}:`, err?.message ?? err);
        out[id] = "";
      }
    }
    return out;
  } catch (err) {
    console.warn(
      "cannot import @l-fight/dataset for icon prompts:",
      err?.message ?? err,
    );
    return Object.fromEntries(iconIds.map((id) => [id, ""]));
  }
}

async function renameS3EntityKeys(oldNumericId, imageId, type) {
  const { S3Client, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } =
    await import("@aws-sdk/client-s3");
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET || "lfm";
  const region = process.env.S3_REGION || "ru-central1";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 env incomplete");
  }
  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  const variants = ["icon", "preview", "original"];
  for (const variant of variants) {
    const srcKey = `${variant}/${type}/${oldNumericId}.jpg`;
    const dstKey = `${variant}/${type}/${imageId}.jpg`;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: srcKey }));
    } catch {
      continue;
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${srcKey}`,
        Key: dstKey,
      }),
    );
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: srcKey }),
    );
    console.log(`S3 ${srcKey} -> ${dstKey}`);
  }
}

async function main() {
  const monsters = readJson("monsters.json");
  const npcs = readJson("npcs.json");
  const appearancePath = path.join(generatedDir, "monster-appearance.json");
  const appearanceById = new Map();
  if (fs.existsSync(appearancePath)) {
    for (const row of readJson("monster-appearance.json")) {
      appearanceById.set(Number(row.id), String(row.appearance ?? ""));
    }
  }

  const monsterImages = [];
  for (const monster of monsters) {
    const imageId = padImageId("m", monster.id);
    monster.image = imageId;
    monsterImages.push({
      id: imageId,
      description: appearanceById.get(Number(monster.id)) ?? "",
    });
  }
  monsterImages.sort((a, b) => a.id.localeCompare(b.id, "en"));

  const npcImages = [];
  for (const npc of npcs) {
    const imageId = padImageId("n", npc.id);
    npc.image = imageId;
    npcImages.push({ id: imageId, description: "" });
  }
  npcImages.sort((a, b) => a.id.localeCompare(b.id, "en"));

  const items = readJson("items.json");
  const skills = readJson("skills.json");
  let renameMap = null;
  const renamePath = path.join(generatedDir, "game-icons-rename-map.json");
  if (fs.existsSync(renamePath)) {
    renameMap = readJson("game-icons-rename-map.json");
  }
  const iconIds = uniqueSortedIconRefs(items, skills);
  const descriptions = await tryBuildIconDescriptions(
    iconIds,
    items,
    skills,
    renameMap,
  );
  const icons = iconIds.map((id) => ({
    id,
    description: descriptions[id] ?? "",
  }));
  const itemIcons = icons.filter((row) => !String(row.id).startsWith("s"));
  const skillIcons = icons.filter((row) => String(row.id).startsWith("s"));

  writeJson("monster-images.json", monsterImages);
  writeJson("npc-images.json", npcImages);
  writeJson("item-icons.json", itemIcons);
  writeJson("skill-icons.json", skillIcons);
  writeJson("monsters.json", monsters);
  writeJson("npcs.json", npcs);

  if (fs.existsSync(appearancePath)) {
    fs.unlinkSync(appearancePath);
    console.log("removed monster-appearance.json");
  }

  if (process.env.MIGRATE_S3 === "1") {
    console.log("renaming S3 keys…");
    for (const monster of monsters) {
      const numeric = Number(String(monster.image).replace(/^m/, ""));
      await renameS3EntityKeys(monster.id, monster.image, "monster");
      void numeric;
    }
    for (const npc of npcs) {
      await renameS3EntityKeys(npc.id, npc.image, "npc");
    }
  } else {
    console.log("skip S3 rename (set MIGRATE_S3=1 to enable)");
  }

  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
