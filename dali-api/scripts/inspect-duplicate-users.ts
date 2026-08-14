/**
 * Groups User rows by normalized name and reports every group with more than
 * one row: all four identity columns (netId, daliEmail, dartmouthEmail,
 * personalEmail), handle, createdAt, and a count of rows in every table that
 * has a foreign key to User — so an operator can tell (a) whether a pair is a
 * real duplicate or two people who share a name, and (b) which row carries the
 * data and should survive a merge.
 *
 * Complements find-duplicate-user-accounts.ts, which only catches the
 * CAS-vs-Google pattern (netId == daliEmail local-part). Name normalization
 * strips a trailing "-N" from last names so previously hand-renamed rows
 * ("Park-2") group with their originals.
 *
 * FK discovery is via information_schema, so new tables are picked up
 * automatically. Caveat: String[] id columns (e.g. participantUserIds) are not
 * FKs and are not counted.
 *
 * Read-only. Requires DATABASE_URL.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/inspect-duplicate-users.ts
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function nameKey(firstName: string, lastName: string): string {
  const norm = (s: string) =>
    s.trim().toLowerCase().replace(/[-\s]*\d+$/, "").replace(/[^a-z]/g, "");
  return `${norm(firstName)}|${norm(lastName)}`;
}

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      netId: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      handle: true,
      createdAt: true,
    },
  });

  const groups = new Map<string, typeof users>();
  for (const u of users) {
    const key = nameKey(u.firstName, u.lastName);
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);

  if (dupGroups.length === 0) {
    console.log("No duplicate-name groups found.");
    return;
  }

  const fkColumns = await prisma.$queryRaw<
    { table_name: string; column_name: string }[]
  >`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'User'
      AND ccu.column_name = 'id'
    ORDER BY tc.table_name, kcu.column_name
  `;

  const dupIds = dupGroups.flat().map((u) => u.id);
  // userId -> "Table.column" -> count, one grouped query per FK column
  const refCounts = new Map<string, Map<string, number>>();
  for (const { table_name, column_name } of fkColumns) {
    const rows = await prisma.$queryRawUnsafe<{ uid: string; n: bigint }[]>(
      `SELECT "${column_name}" AS uid, COUNT(*)::bigint AS n
       FROM "${table_name}"
       WHERE "${column_name}" = ANY($1)
       GROUP BY 1`,
      dupIds,
    );
    for (const { uid, n } of rows) {
      const byRef = refCounts.get(uid) ?? new Map<string, number>();
      byRef.set(`${table_name}.${column_name}`, Number(n));
      refCounts.set(uid, byRef);
    }
  }

  dupGroups.sort((a, b) =>
    `${a[0].lastName} ${a[0].firstName}`.localeCompare(
      `${b[0].lastName} ${b[0].firstName}`,
    ),
  );

  console.log(
    `Duplicate-name groups: ${dupGroups.length} (checked ${fkColumns.length} FK columns referencing User)\n`,
  );
  for (const group of dupGroups) {
    const distinctNetIds = group.filter((u) => u.netId).length;
    console.log(`${group[0].firstName} ${group[0].lastName} — ${group.length} rows`);
    if (distinctNetIds > 1) {
      console.log(
        "  ⚠ multiple rows have their own netId — likely different people, not a duplicate",
      );
    }
    for (const u of group.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      console.log(`  ${u.id}  created ${u.createdAt.toISOString().slice(0, 10)}`);
      console.log(
        `    netId=${u.netId ?? "—"}  dali=${u.daliEmail ?? "—"}  dartmouth=${u.dartmouthEmail ?? "—"}  personal=${u.personalEmail ?? "—"}  handle=${u.handle ?? "—"}`,
      );
      const byRef = refCounts.get(u.id);
      const refs = byRef
        ? [...byRef.entries()].map(([ref, n]) => `${ref}:${n}`).join("  ")
        : "";
      console.log(`    data: ${refs || "(none)"}`);
    }
    console.log();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
