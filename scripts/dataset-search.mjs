#!/usr/bin/env node
/**
 * Поиск по dataset через dataset-api (JSON в .cursorignore).
 *
 * Usage:
 *   pnpm dataset:search "кровавая корона"
 *   pnpm dataset:search "sword" --types=icons,monsters --limit=10
 *   DATASET_API_URL=http://localhost:3006 pnpm dataset:search "m0001"
 */
const args = process.argv.slice(2);
const flags = new Map();
const positional = [];

for (const arg of args) {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    if (eq === -1) flags.set(arg.slice(2), true);
    else flags.set(arg.slice(2, eq), arg.slice(eq + 1));
  } else {
    positional.push(arg);
  }
}

const q = positional.join(" ").trim();
if (!q || flags.has("help") || flags.has("h")) {
  console.log(`Usage: pnpm dataset:search "<query>" [--types=a,b] [--limit=20]

Requires dataset-api on DATASET_API_URL (default http://localhost:3006).`);
  process.exit(q ? 0 : 1);
}

const base = String(
  process.env.DATASET_API_URL || "http://localhost:3006",
).replace(/\/$/, "");
const limit = Number(flags.get("limit") || 20);
const types = flags.get("types");

const url = new URL(`${base}/api/admin/search`);
url.searchParams.set("q", q);
url.searchParams.set("limit", String(Number.isFinite(limit) ? limit : 20));
if (typeof types === "string" && types.trim()) {
  url.searchParams.set("types", types.trim());
}

let res;
try {
  res = await fetch(url);
} catch (err) {
  console.error(
    `dataset-api unreachable at ${base}. Start with: pnpm dev:dataset-api`,
  );
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const items = Array.isArray(data.items) ? data.items : [];
console.log(
  `query=${JSON.stringify(q)} total=${data.total ?? items.length} indexed=${data.indexed ?? "?"}`,
);
for (const hit of items) {
  const title =
    hit.title && hit.title !== hit.id ? ` — ${hit.title}` : "";
  const snippet = hit.snippet ? ` | ${hit.snippet}` : "";
  console.log(`[${hit.type}] ${hit.id}${title}${snippet}`);
}

if (items.length === 0) {
  process.exitCode = 2;
}
