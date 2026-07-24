/**
 * Backfill User.handle for existing DALI members who don't have one, so they
 * can be @-mentioned in page-doc guides and FAQ comments. New users get a
 * handle seeded on login/provision (app/lib/handle.ts assignHandleIfMissing);
 * this is the one-off pass for everyone who predates that.
 *
 * Scoped to users with a DALIMember row (lab members), not applicants/partners.
 *
 * Derivation mirrors app/lib/handle.ts exactly: first-initial + last-name,
 * lowercased and stripped to [a-z0-9], then a numeric suffix ("spark", "spark2",
 * …) to stay unique. Uniqueness is checked against both already-set handles and
 * the ones this run has assigned, so two "S. Park"s get distinct handles.
 *
 * Dry-run by default. Uses DATABASE_URL, or PROD_DATABASE_URL when
 * --prod is passed (so local .env can keep both without swapping).
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-handles.ts                # dry run (local)
 *   npx tsx --env-file .env scripts/backfill-handles.ts --prod         # dry run (prod)
 *   npx tsx --env-file .env scripts/backfill-handles.ts --prod --commit
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const COMMIT = process.argv.includes("--commit");
const USE_PROD = process.argv.includes("--prod");
const connectionString = USE_PROD
  ? process.env.PROD_DATABASE_URL
  : process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    USE_PROD
      ? "PROD_DATABASE_URL is not set."
      : "DATABASE_URL is not set.",
  );
  process.exit(1);
}
try {
  const host = new URL(connectionString).hostname;
  console.log(`Target: ${USE_PROD ? "PROD_DATABASE_URL" : "DATABASE_URL"} (${host})\n`);
} catch {
  console.log(`Target: ${USE_PROD ? "PROD_DATABASE_URL" : "DATABASE_URL"}\n`);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const MAX_HANDLE_LENGTH = 30;

function baseHandle(firstName: string, lastName: string): string {
  const first = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const last = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = last ? `${first.slice(0, 1)}${last}` : first;
  return base.slice(0, MAX_HANDLE_LENGTH) || "member";
}

async function main() {
  console.log(
    COMMIT
      ? "▶ COMMIT mode — handles WILL be written.\n"
      : "▶ DRY RUN — no changes will be written. Re-run with --commit to apply.\n",
  );

  // Every handle already in use — seed the taken-set so the backfill never
  // collides with an existing handle or with one it assigns earlier in the run.
  const taken = new Set(
    (
      await prisma.user.findMany({
        where: { handle: { not: null } },
        select: { handle: true },
      })
    ).map((u) => u.handle!),
  );

  // Lab members only (DALIMember marker). Skip applicants / partners / orphans.
  const users = await prisma.user.findMany({
    where: { handle: null, daliMember: { isNot: null } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const alreadyHave = await prisma.user.count({
    where: { handle: { not: null }, daliMember: { isNot: null } },
  });
  console.log(
    `DALI members: ${alreadyHave} already have a handle; ${users.length} missing one.\n`,
  );

  const assigned: string[] = [];
  for (const u of users) {
    const base = baseHandle(u.firstName, u.lastName);
    let handle = base;
    for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}${suffix}`;
    taken.add(handle);
    assigned.push(`${u.firstName} ${u.lastName} → @${handle}`);
    if (COMMIT) {
      await prisma.user.update({ where: { id: u.id }, data: { handle } });
    }
  }

  console.log(`Assigned (${assigned.length})${COMMIT ? " — written" : " — would write"}:`);
  console.log(assigned.length ? "  " + assigned.join("\n  ") : "  (none)");
  if (!COMMIT && assigned.length > 0) {
    console.log("\nRe-run with --commit to write these handles.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
