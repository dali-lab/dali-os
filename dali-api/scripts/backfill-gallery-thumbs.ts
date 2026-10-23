/**
 * Backfill GalleryPost.thumbKey for posts wider than the feed thumbnail that
 * have none, so their tiles stop loading the full original. These are posts
 * from before thumbnails shipped (#2327) and posts made in WebKit (Safari, the
 * macOS desktop app), whose canvas couldn't encode WebP until the JPEG fallback.
 *
 * Resizes in headless Chrome the way the composer does (createImageBitmap
 * applies the photo's EXIF rotation, then a 640px canvas encodes WebP) and
 * uploads it next to the original under the poster's gallery prefix.
 * Idempotent: a post that already has a thumbnail is skipped, so a rerun picks
 * up only what failed. Needs Chrome installed, or CHROMIUM_EXECUTABLE_PATH.
 *
 * Dry-run by default. Uses DATABASE_URL, or PROD_DATABASE_URL with --prod.
 * S3 comes from AWS_REGION / AWS_S3_BUCKET / AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY, so point those at the bucket the database's keys live in.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-gallery-thumbs.ts --prod
 *   npx tsx --env-file .env scripts/backfill-gallery-thumbs.ts --prod --commit
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getObjectBytes, isS3Configured, putObject } from "../app/lib/s3";
import { GALLERY_THUMB_WIDTH, galleryKeyPrefix } from "../app/community/lib/gallery";

const COMMIT = process.argv.includes("--commit");
const USE_PROD = process.argv.includes("--prod");
const connectionString = USE_PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!connectionString) {
  console.error(USE_PROD ? "PROD_DATABASE_URL is not set." : "DATABASE_URL is not set.");
  process.exit(1);
}
if (!isS3Configured()) {
  console.error("AWS S3 is not configured (AWS_REGION, AWS_S3_BUCKET, credentials).");
  process.exit(1);
}
console.log(`Target: ${USE_PROD ? "PROD_DATABASE_URL" : "DATABASE_URL"} (${new URL(connectionString).hostname})`);
console.log(`Bucket: ${process.env.AWS_S3_BUCKET}\n`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const CHROME = process.env.CHROMIUM_EXECUTABLE_PATH?.trim() || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function resize(page: Page, original: Buffer): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ data, width }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round((bitmap.height * width) / bitmap.width);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.82));
      if (blob?.type !== "image/webp") throw new Error("WebP encode failed");
      const out = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { data: original.toString("base64"), width: GALLERY_THUMB_WIDTH },
  );
  return Buffer.from(base64, "base64");
}

async function main() {
  console.log(COMMIT ? "▶ COMMIT mode: thumbnails WILL be uploaded and saved.\n" : "▶ DRY RUN: pass --commit to write.\n");

  const posts = await prisma.galleryPost.findMany({
    where: { thumbKey: null, width: { gt: GALLERY_THUMB_WIDTH } },
    select: { id: true, authorId: true, imageKey: true, width: true, height: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${posts.length} post(s) need a thumbnail.\n`);

  const browser = COMMIT && posts.length ? await chromium.launch({ headless: true, executablePath: CHROME }) : null;
  const page = browser ? await browser.newPage() : null;
  let done = 0;
  let failed = 0;
  for (const post of posts) {
    const label = `${post.id} ${post.width}×${post.height} ${post.imageKey}`;
    if (!COMMIT) {
      console.log(`  would thumbnail ${label}`);
      continue;
    }
    try {
      const { body } = await getObjectBytes(post.imageKey);
      const thumb = await resize(page!, body);
      const thumbKey = `uploads/${galleryKeyPrefix(post.authorId)}/${randomUUID()}-thumb.webp`;
      await putObject(thumbKey, thumb, "image/webp");
      await prisma.galleryPost.update({ where: { id: post.id }, data: { thumbKey } });
      done++;
      console.log(`  ✓ ${label} → ${(body.length / 1e6).toFixed(1)} MB to ${(thumb.length / 1e3).toFixed(0)} KB`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await browser?.close();
  if (COMMIT) console.log(`\nDone: ${done} thumbnailed, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
