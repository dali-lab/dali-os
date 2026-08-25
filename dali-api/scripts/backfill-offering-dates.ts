/**
 * Backfill EducationOffering.startsAt / endsAt / termId from sessions for all
 * existing offerings, now that these fields are derived rather than manually
 * entered.
 *
 * Offerings with no sessions are set to null on all three fields (they are
 * draft stubs with no schedule yet). Offerings with sessions get startsAt =
 * earliest session datetime, endsAt = latest session datetime, and termId
 * derived from startsAt.
 *
 * Dry-run by default.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-offering-dates.ts           # dry run
 *   npx tsx --env-file .env scripts/backfill-offering-dates.ts --commit  # write to DB
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

async function termIdForDate(date: Date): Promise<string | null> {
  const term = await prisma.term.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { sortKey: "desc" },
    select: { id: true },
  });
  return term?.id ?? null;
}

async function main() {
  const offerings = await prisma.educationOffering.findMany({
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      termId: true,
      sessions: {
        orderBy: { datetime: "asc" },
        select: { datetime: true },
      },
    },
  });

  console.log(`Found ${offerings.length} offering(s) to process.`);

  let updated = 0;
  let unchanged = 0;

  for (const offering of offerings) {
    const sessions = offering.sessions;
    const newStartsAt = sessions.length > 0 ? sessions[0].datetime : null;
    const newEndsAt = sessions.length > 0 ? sessions[sessions.length - 1].datetime : null;
    const newTermId =
      newStartsAt != null ? await termIdForDate(newStartsAt) : null;

    const alreadyCorrect =
      offering.startsAt?.getTime() === newStartsAt?.getTime() &&
      offering.endsAt?.getTime() === newEndsAt?.getTime() &&
      offering.termId === newTermId;

    if (alreadyCorrect) {
      unchanged += 1;
      continue;
    }

    console.log(
      `[${commit ? "UPDATE" : "DRY"}] "${offering.title}" (${offering.id}): ` +
        `startsAt=${newStartsAt?.toISOString() ?? "null"} ` +
        `endsAt=${newEndsAt?.toISOString() ?? "null"} ` +
        `termId=${newTermId ?? "null"}`,
    );

    if (commit) {
      await prisma.educationOffering.update({
        where: { id: offering.id },
        data: { startsAt: newStartsAt, endsAt: newEndsAt, termId: newTermId },
      });
    }

    updated += 1;
  }

  console.log(
    `\nDone. ${updated} updated, ${unchanged} already correct.` +
      (commit ? "" : " (dry run — pass --commit to write)"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
