/**
 * One-time backfill: un-nest ProjectFile rows that were placed inside a real
 * "drive:offering:<id>" folder Page (the now-removed auto-folder pattern).
 *
 * Two steps, both idempotent:
 *   1. For every non-archived ProjectFile whose folderPageId points to a Page
 *      with a systemKey starting "drive:offering:", clear folderPageId → null.
 *      drive-scopes.server reparents null-folder files under the synthetic
 *      offering folder, so files appear directly under Education → [Course].
 *   2. Soft-archive (set archivedAt = now) every Page with a systemKey starting
 *      "drive:offering:". These are the redundant auto-folders; archiving them
 *      removes the double-nesting without destroying audit history.
 *
 * Dry-run by default.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-offering-drive-denest.ts           # dry run
 *   npx tsx --env-file .env scripts/backfill-offering-drive-denest.ts --commit  # write to DB
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const commit = process.argv.includes("--commit");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // ── Step 1: Find all offering auto-folder Pages ───────────────────────────
  const autoFolders = await prisma.page.findMany({
    where: {
      systemKey: { startsWith: "drive:offering:" },
      archivedAt: null,
    },
    select: { id: true, systemKey: true, title: true },
  });
  console.log(`Found ${autoFolders.length} offering auto-folder page(s) to process.`);

  const autoFolderIds = autoFolders.map((f) => f.id);

  // ── Step 2: Un-nest files pointing at those folders ───────────────────────
  if (autoFolderIds.length === 0) {
    console.log("No auto-folders found — nothing to denest.");
  } else {
    const affectedFiles = await prisma.projectFile.findMany({
      where: {
        folderPageId: { in: autoFolderIds },
        archivedAt: null,
      },
      select: { id: true, title: true, folderPageId: true },
    });
    console.log(`Found ${affectedFiles.length} file(s) nested inside auto-folders.`);

    for (const file of affectedFiles) {
      const folder = autoFolders.find((f) => f.id === file.folderPageId);
      console.log(
        `  [${commit ? "UPDATE" : "DRY"}] File "${file.title}" (${file.id}): ` +
          `folderPageId ${file.folderPageId} → null  (was in "${folder?.systemKey}")`,
      );
    }

    if (commit && affectedFiles.length > 0) {
      const result = await prisma.projectFile.updateMany({
        where: {
          folderPageId: { in: autoFolderIds },
          archivedAt: null,
        },
        data: { folderPageId: null },
      });
      console.log(`  Updated ${result.count} file(s).`);
    }
  }

  // ── Step 3: Soft-archive the auto-folder Pages ────────────────────────────
  const alreadyArchived = await prisma.page.findMany({
    where: {
      systemKey: { startsWith: "drive:offering:" },
      archivedAt: { not: null },
    },
    select: { id: true },
  });
  console.log(`\n${alreadyArchived.length} auto-folder page(s) already archived (skipping).`);
  console.log(`Archiving ${autoFolders.length} remaining auto-folder page(s).`);

  for (const folder of autoFolders) {
    console.log(
      `  [${commit ? "ARCHIVE" : "DRY"}] Page "${folder.title}" (${folder.id}) systemKey=${folder.systemKey}`,
    );
  }

  if (commit && autoFolders.length > 0) {
    const result = await prisma.page.updateMany({
      where: {
        systemKey: { startsWith: "drive:offering:" },
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });
    console.log(`  Archived ${result.count} page(s).`);
  }

  console.log(
    `\nDone.` + (commit ? "" : " (dry run — pass --commit to write)"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
