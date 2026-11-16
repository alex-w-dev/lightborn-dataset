/**
 * Скачивает весь S3-бакет в ./s3-backup
 *
 *   pnpm s3:backup
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(
  path.join(root, 'packages/lightborn-api/package.json'),
);
const { config } = require('dotenv');
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');

config({ path: path.join(root, '.env') });

const OUT_DIR = path.join(root, 's3-backup');
const CONCURRENCY = 16;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

async function listAllKeys(client, bucket) {
  const keys = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith('/')) continue;
      keys.push({ key: obj.Key, size: obj.Size ?? 0 });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
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

async function main() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region = process.env.S3_REGION?.trim() || 'ru-central1';
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    process.env.S3_SECRET_KEY?.trim();
  const bucket = requiredEnv('S3_BUCKET');
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set in .env');
  }

  const client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`Listing s3://${bucket} …`);
  const objects = await listAllKeys(client, bucket);
  console.log(`Objects: ${objects.length}`);
  console.log(`Out: ${OUT_DIR}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  await mapPool(objects, CONCURRENCY, async ({ key, size }) => {
    const dest = path.join(OUT_DIR, ...key.split('/'));
    if (fs.existsSync(dest)) {
      const st = fs.statSync(dest);
      if (st.size === size) {
        skipped++;
        return;
      }
    }

    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!res.Body) throw new Error('empty body');
      await pipeline(res.Body, fs.createWriteStream(dest));
      downloaded++;
      if ((downloaded + skipped) % 100 === 0) {
        console.log(
          `… ${downloaded} downloaded, ${skipped} skipped, ${failed} failed / ${objects.length}`,
        );
      }
    } catch (err) {
      failed++;
      console.error(`FAIL ${key}: ${err.message}`);
    }
  });

  console.log(
    `Done. downloaded=${downloaded} skipped=${skipped} failed=${failed} total=${objects.length}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
