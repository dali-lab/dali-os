/**
 * One-time backfill: create a Drive folder (systemKey = "drive:offering:<id>")
 * for every EducationOffering that doesn't already have one.
 *
 * Safe to re-run — ensureOfferingDriveFolder is idempotent via systemKey.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-offering-folders.ts           # dry run
 *   npx tsx --env-file .env scripts/backfill-offering-folders.ts --commit  # write to DB
 */

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const dry = !process.argv.includes("--commit");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const offerings = await prisma.educationOffering.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${offerings.length} offerings.`);

  // Find the first Core or admin user to act as createdById for the folder pages.
  const actor = await prisma.user.findFirst({
    where: { daliMember: { isNot: null } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!actor) {
    console.error("No lab member found — cannot create pages without a createdById.");
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;

  for (const offering of offerings) {
    const existing = await prisma.page.findUnique({
      where: { systemKey: `drive:offering:${offering.id}` },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    if (dry) {
      console.log(`  [dry] Would create folder for offering "${offering.title}" (${offering.id})`);
      created++;
      continue;
    }
    // Reuse the same logic as ensureOfferingDriveFolder.
    const last = await prisma.page.findFirst({
      where: {
        workspaceType: "EducationOffering",
        workspaceId: offering.id,
        parentPageId: null,
      },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    await prisma.page.create({
      data: {
        workspaceType: "EducationOffering",
        workspaceId: offering.id,
        title: offering.title,
        kind: "Folder",
        position: last ? last.position + 1 : 0,
        parentPageId: null,
        createdById: actor.id,
        systemKey: `drive:offering:${offering.id}`,
        linkAccess: "Restricted",
        linkPermission: "View",
      },
      select: { id: true },
    });
    console.log(`  Created folder for offering "${offering.title}" (${offering.id})`);
    created++;
  }

  console.log(
    dry
      ? `Dry run complete. ${created} would be created, ${skipped} already exist.`
      : `Done. ${created} created, ${skipped} already existed.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
