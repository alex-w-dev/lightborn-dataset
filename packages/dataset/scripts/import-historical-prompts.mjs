/**
 * Исторические промпты → description в asset-каталоге (content only).
 *
 *   node packages/dataset/scripts/import-historical-prompts.mjs
 *
 * Icons: All-prompts/*.txt (+ fallback game-icons-all-prompts.json)
 * Monsters: lightborn-ui monster-prompts.json → monster-images.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const generatedDir = path.resolve(__dirname, "../src/generated");

const ALL_PROMPTS_DIR =
  process.env.GAME_ICONS_ALL_PROMPTS_DIR?.trim() ||
  "D:\\C_backup\\Users\\Alex\\Downloads\\Icons\\Icons\\All-prompts";

const ALL_PROMPTS_JSON = path.join(
  repoRoot,
  "packages/dataset-ui/src/prompts/game-icons-all-prompts.json",
);
const MONSTER_PROMPTS_JSON = path.join(
  repoRoot,
  "packages/lightborn-ui/src/gm/gamedata/prompts/monster-prompts.json",
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeGenerated(fileName, data) {
  const filePath = path.join(generatedDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`wrote ${fileName}`);
}

function loadTxtPrompts(dir) {
  const map = new Map();
  if (!fs.existsSync(dir)) {
    console.warn(`All-prompts dir missing: ${dir}`);
    return map;
  }
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".txt")) continue;
    const id = name.slice(0, -4).trim();
    if (!id) continue;
    const text = fs
      .readFileSync(path.join(dir, name), "utf8")
      .replace(/^\uFEFF/, "")
      .trim();
    map.set(id, text);
  }
  return map;
}

function importIconsFile(fileName) {
  const icons = readJson(path.join(generatedDir, fileName));
  const fromTxt = loadTxtPrompts(ALL_PROMPTS_DIR);
  let fromJson = {};
  if (fs.existsSync(ALL_PROMPTS_JSON)) {
    fromJson = readJson(ALL_PROMPTS_JSON);
  }

  let fromTxtCount = 0;
  let fromJsonCount = 0;
  let empty = 0;
  const next = icons.map((row) => {
    const id = String(row.id ?? "").trim();
    let description = "";
    if (fromTxt.has(id)) {
      description = fromTxt.get(id) ?? "";
      fromTxtCount += 1;
    } else if (typeof fromJson[id] === "string" && fromJson[id].trim()) {
      description = fromJson[id].replace(/^\uFEFF/, "").trim();
      fromJsonCount += 1;
    } else {
      empty += 1;
    }
    return { ...row, description };
  });

  const catalogIds = new Set(next.map((r) => r.id));
  const txtOnly = [...fromTxt.keys()].filter((id) => !catalogIds.has(id));
  console.log(
    `${fileName}: ${next.length} rows; txt=${fromTxtCount} jsonFallback=${fromJsonCount} empty=${empty}; txtNotInCatalog=${txtOnly.length}`,
  );
  writeGenerated(fileName, next);
}

function importIcons() {
  importIconsFile("item-icons.json");
  importIconsFile("skill-icons.json");
}

function monsterIdFromPromptKey(key) {
  const n = Number(String(key).trim());
  if (!Number.isInteger(n) || n < 1) return null;
  return `m${String(n).padStart(4, "0")}`;
}

function importMonsters() {
  const images = readJson(path.join(generatedDir, "monster-images.json"));
  const prompts = readJson(MONSTER_PROMPTS_JSON);
  const byId = new Map();
  for (const [key, text] of Object.entries(prompts)) {
    const id = monsterIdFromPromptKey(key);
    if (!id) continue;
    if (typeof text !== "string") continue;
    byId.set(id, text.replace(/^\uFEFF/, "").trim());
  }

  let updated = 0;
  let empty = 0;
  const next = images.map((row) => {
    const id = String(row.id ?? "").trim();
    const description = byId.get(id) ?? "";
    if (description) updated += 1;
    else empty += 1;
    return { ...row, description };
  });

  console.log(
    `monsters: ${next.length} rows; updated=${updated} empty=${empty}; promptKeys=${byId.size}`,
  );
  writeGenerated("monster-images.json", next);
}

importIcons();
importMonsters();
console.log("done");
