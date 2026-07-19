/**
 * Backfill User.handle for existing members who don't have one, so they can be
 * @-mentioned in page-doc guides and FAQ comments. New users get a handle
 * seeded on login/provision (app/lib/handle.ts assignHandleIfMissing); this is
 * the one-off pass for everyone who predates that.
 *
 * Derivation mirrors app/lib/handle.ts exactly: first-initial + last-name,
 * lowercased and stripped to [a-z0-9], then a numeric suffix ("spark", "spark2",
 * …) to stay unique. Uniqueness is checked against both already-set handles and
 * the ones this run has assigned, so two "S. Park"s get distinct handles.
 *
 * Dry-run by default. Requires DATABASE_URL.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-handles.ts          # dry run
 *   npx tsx --env-file .env scripts/backfill-handles.ts --commit # write handles
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes("--commit");
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

  const users = await prisma.user.findMany({
    where: { handle: null },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

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
