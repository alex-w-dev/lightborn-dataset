/**
 * Копирует ассеты в новый контракт:
 *   img/{kind}/{id}/{64|512|original}.jpg
 *   music/{wave}/{id}/original.ogg
 *   sfx/{id}/original.ogg
 *
 * Старые ключи не удаляет. Запуск:
 *   node scripts/migrate-s3-asset-paths.mjs
 *   node scripts/migrate-s3-asset-paths.mjs --dry-run
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireApi = createRequire(
  path.join(root, "packages/lightborn-api/package.json"),
);
const requireDatasetApi = createRequire(
  path.join(root, "packages/dataset-api/package.json"),
);
const { config } = requireApi("dotenv");
const sharp = requireDatasetApi("sharp");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} = requireApi("@aws-sdk/client-s3");

config({ path: path.join(root, ".env") });

const DRY = process.argv.includes("--dry-run");
const CONCURRENCY = 8;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, "");
}

async function listAllKeys(client, bucket, prefix = "") {
  const keys = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue;
      keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function exists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function getBuffer(client, bucket, key) {
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function put(client, bucket, key, body, contentType) {
  if (DRY) {
    console.log(`  PUT ${key} (${body.length} bytes)`);
    return;
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

async function mapPool(items, concurrency, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

async function ensureImgVariants(client, bucket, kind, id, sourceBuf) {
  const jpegOpts = { quality: 90 };
  const original = await sharp(sourceBuf).jpeg(jpegOpts).toBuffer();
  const jpeg512 = await sharp(original)
    .resize(512, 512, { fit: "cover" })
    .jpeg(jpegOpts)
    .toBuffer();
  const jpeg64 = await sharp(original)
    .resize(64, 64, { fit: "cover" })
    .jpeg(jpegOpts)
    .toBuffer();
  const targets = [
    [`img/${kind}/${id}/original.jpg`, original],
    [`img/${kind}/${id}/512.jpg`, jpeg512],
    [`img/${kind}/${id}/64.jpg`, jpeg64],
  ];
  for (const [key, body] of targets) {
    if (await exists(client, bucket, key)) continue;
    await put(client, bucket, key, body, "image/jpeg");
  }
}

function planFromKeys(keys) {
  /** @type {Array<{ kind: string, id: string, sourceKey: string, prefer?: number }>} */
  const images = [];
  /** @type {Array<{ wave: string, id: string, sourceKey: string }>} */
  const music = [];
  /** @type {Array<{ id: string, sourceKey: string }>} */
  const sfx = [];
  let catalogKey = null;

  for (const key of keys) {
    let m;
    if ((m = /^ico\/(64|512)\/([^/]+)\.jpe?g$/i.exec(key))) {
      const id = m[2];
      const kind = id.toLowerCase().startsWith("s") ? "skills" : "items";
      images.push({
        kind,
        id,
        sourceKey: key,
        prefer: Number(m[1]),
      });
      continue;
    }
    if ((m = /^(preview|icon|original)\/(monster|npc|chars|skill|item)\/([^/]+)\.jpe?g$/i.exec(key))) {
      const variant = m[1].toLowerCase();
      const type = m[2].toLowerCase();
      const id = m[3];
      const kindMap = {
        monster: "monsters",
        npc: "npcs",
        chars: "chars",
        skill: "skills",
        item: "items",
      };
      const prefer =
        variant === "preview" ? 512 : variant === "icon" ? 64 : 1024;
      images.push({ kind: kindMap[type], id, sourceKey: key, prefer });
      continue;
    }
    if ((m = /^bg\/([^/]+)$/i.exec(key))) {
      images.push({
        kind: "backgrounds",
        id: stripExt(m[1]),
        sourceKey: key,
        prefer: 1024,
      });
      continue;
    }
    if ((m = /^map\/locs\/preview\/([^/]+)$/i.exec(key))) {
      images.push({
        kind: "locations",
        id: stripExt(m[1]),
        sourceKey: key,
        prefer: 64,
      });
      continue;
    }
    if ((m = /^map\/locs\/([^/]+)$/i.exec(key)) && !key.includes("/preview/")) {
      images.push({
        kind: "locations",
        id: stripExt(m[1]),
        sourceKey: key,
        prefer: 512,
      });
      continue;
    }
    if ((m = /^music\/(peace|battle|lobby)\/([^/]+)\.ogg$/i.exec(key))) {
      music.push({ wave: m[1].toLowerCase(), id: m[2], sourceKey: key });
      continue;
    }
    if ((m = /^audio\/sfx\/([^/]+)\.ogg$/i.exec(key))) {
      sfx.push({ id: m[1], sourceKey: key });
      continue;
    }
    if (key === "audio/sfx/catalog.json") {
      catalogKey = key;
    }
  }

  /** Лучший source на (kind,id). */
  const bestImage = new Map();
  for (const row of images) {
    const k = `${row.kind}/${row.id}`;
    const prev = bestImage.get(k);
    if (!prev || (row.prefer ?? 0) > (prev.prefer ?? 0)) {
      bestImage.set(k, row);
    }
  }

  return {
    images: [...bestImage.values()],
    music,
    sfx,
    catalogKey,
  };
}

async function main() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region = process.env.S3_REGION?.trim() || "ru-central1";
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() || process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    process.env.S3_SECRET_KEY?.trim();
  const bucket = requiredEnv("S3_BUCKET");
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("S3 credentials not set in .env");
  }

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(DRY ? "DRY-RUN" : "MIGRATE", `bucket=${bucket}`);
  const keys = await listAllKeys(client, bucket);
  console.log(`Listed ${keys.length} keys`);
  const plan = planFromKeys(keys);
  console.log(
    `Plan: images=${plan.images.length}, music=${plan.music.length}, sfx=${plan.sfx.length}, catalog=${Boolean(plan.catalogKey)}`,
  );

  let done = 0;
  await mapPool(plan.images, CONCURRENCY, async (row) => {
    try {
      const buf = await getBuffer(client, bucket, row.sourceKey);
      await ensureImgVariants(client, bucket, row.kind, row.id, buf);
      done += 1;
      if (done % 50 === 0) console.log(`  images ${done}/${plan.images.length}`);
    } catch (e) {
      console.error(`FAIL image ${row.sourceKey}:`, e.message || e);
    }
  });

  done = 0;
  await mapPool(plan.music, CONCURRENCY, async (row) => {
    try {
      const dest = `music/${row.wave}/${row.id}/original.ogg`;
      if (!(await exists(client, bucket, dest))) {
        const buf = await getBuffer(client, bucket, row.sourceKey);
        await put(client, bucket, dest, buf, "audio/ogg");
      }
      done += 1;
    } catch (e) {
      console.error(`FAIL music ${row.sourceKey}:`, e.message || e);
    }
  });

  done = 0;
  await mapPool(plan.sfx, CONCURRENCY, async (row) => {
    try {
      const dest = `sfx/${row.id}/original.ogg`;
      if (!(await exists(client, bucket, dest))) {
        const buf = await getBuffer(client, bucket, row.sourceKey);
        await put(client, bucket, dest, buf, "audio/ogg");
      }
      done += 1;
    } catch (e) {
      console.error(`FAIL sfx ${row.sourceKey}:`, e.message || e);
    }
  });

  if (plan.catalogKey) {
    const dest = "sfx/catalog.json";
    if (!(await exists(client, bucket, dest))) {
      const buf = await getBuffer(client, bucket, plan.catalogKey);
      await put(client, bucket, dest, buf, "application/json");
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
