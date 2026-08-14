/**
 * Merges one duplicate User row into another: re-parents every table with a
 * foreign key to User (discovered from the catalog, so new tables are covered
 * automatically), coalesces identity/profile columns onto the surviving row,
 * and deletes the duplicate. Built for the member+student duplicate pairs
 * surfaced by inspect-duplicate-users.ts; the operator picks the survivor per
 * pair — nothing is inferred.
 *
 * Unique-constraint collisions (both rows have a row in a table whose unique
 * index includes the user FK — e.g. both have a DALIMember marker) are
 * resolved by policy: for marker-style tables the losing row is deleted; for
 * anything else (duplicate Application in the same cycle, etc.) the merge is
 * BLOCKED and the conflicting rows are reported for a manual decision first.
 * Commit mode runs in a single transaction, so a surprise (e.g. deleting a
 * marker some new table now references) rolls everything back.
 *
 * Caveat: String[] id columns (e.g. ScheduledMeeting.participantUserIds) are
 * not FKs and are not re-parented.
 *
 * Dry-run by default. Requires DATABASE_URL.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/merge-duplicate-users.ts --keep <userId> --drop <userId>
 *   DATABASE_URL=... npx tsx scripts/merge-duplicate-users.ts --keep <userId> --drop <userId> --commit
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes("--commit");

// A colliding row on the losing side of these tables is a redundant marker
// (same eligibility, same signature, same settings) — safe to delete in favor
// of the survivor's row. Everything else blocks the merge for manual review.
const DROP_LOSER_ON_COLLISION = new Set([
  "DALIMember",
  "AdminMembership",
  "UserAvailabilitySettings",
  "DomainEligibility",
  "NotificationPreference",
  "ConfidentialityAgreementSignature",
  "CycleReviewer",
  "CycleInterviewer",
]);

// Nullable single-value columns copied from the dropped row when the kept row
// has no value. Unique ones (netId, emails, handle…) are cleared on the
// dropped row first, inside the same transaction, to avoid a constraint hit.
const COALESCE_COLUMNS = [
  "netId",
  "daliEmail",
  "dartmouthEmail",
  "personalEmail",
  "slackUserId",
  "handle",
  "timeZone",
  "classYear",
  "graduatedAt",
  "pronouns",
  "photoUrl",
  "bioDocId",
  "major",
  "hometown",
  "linkedinUrl",
  "githubUsername",
  "personalSite",
] as const;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function main() {
  const keepId = argValue("--keep");
  const dropId = argValue("--drop");
  if (!keepId || !dropId || keepId === dropId) {
    console.error("Usage: merge-duplicate-users.ts --keep <userId> --drop <userId> [--commit]");
    process.exit(1);
  }

  const keep = await prisma.user.findUnique({ where: { id: keepId } });
  const drop = await prisma.user.findUnique({ where: { id: dropId } });
  if (!keep || !drop) {
    console.error(`User not found: ${!keep ? keepId : dropId}`);
    process.exit(1);
  }
  if (keep.netId && drop.netId) {
    console.error(
      `Both rows have a netId (${keep.netId} / ${drop.netId}) — two distinct Dartmouth identities. Refusing to merge.`,
    );
    process.exit(1);
  }

  console.log(COMMIT ? "▶ COMMIT mode\n" : "▶ DRY RUN — re-run with --commit to apply.\n");
  for (const [label, u] of [["KEEP", keep], ["DROP", drop]] as const) {
    console.log(
      `${label}  ${u.id}  ${u.firstName} ${u.lastName}  netId=${u.netId ?? "—"}  dali=${u.daliEmail ?? "—"}  dartmouth=${u.dartmouthEmail ?? "—"}`,
    );
  }
  console.log();

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

  // Non-partial, non-expression unique indexes, keyed by table.
  const uniqueIndexes = await prisma.$queryRaw<
    { table_name: string; cols: string[] }[]
  >`
    SELECT t.relname::text AS table_name,
           array_agg(a.attname::text ORDER BY x.ord) AS cols
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS x(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
    WHERE i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
      AND n.nspname = 'public'
    GROUP BY i.indexrelid, t.relname
  `;

  // Rows on the DROP side that would violate a unique index if re-parented,
  // because the KEEP side already has the matching row. The predicate doubles
  // as the deletion filter in commit mode.
  const collisionPredicate = (table: string, fkCol: string, idxCols: string[]) => {
    const others = idxCols.filter((c) => c !== fkCol);
    const match = others
      .map((c) => `s.${q(c)} IS NOT DISTINCT FROM l.${q(c)}`)
      .join(" AND ");
    return `l.${q(fkCol)} = $1 AND EXISTS (
      SELECT 1 FROM ${q(table)} s WHERE s.${q(fkCol)} = $2${match ? ` AND ${match}` : ""}
    )`;
  };

  type Plan = {
    table: string;
    fkCol: string;
    total: number;
    collisions: { idxCols: string[]; count: number }[];
  };
  const plans: Plan[] = [];
  for (const { table_name, column_name } of fkColumns) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM ${q(table_name)} WHERE ${q(column_name)} = $1`,
      dropId,
    );
    if (Number(n) === 0) continue;

    const collisions: Plan["collisions"] = [];
    for (const idx of uniqueIndexes.filter(
      (i) => i.table_name === table_name && i.cols.includes(column_name),
    )) {
      const [{ c }] = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*)::bigint AS c FROM ${q(table_name)} l
         WHERE ${collisionPredicate(table_name, column_name, idx.cols)}`,
        dropId,
        keepId,
      );
      if (Number(c) > 0) collisions.push({ idxCols: idx.cols, count: Number(c) });
    }
    plans.push({ table: table_name, fkCol: column_name, total: Number(n), collisions });
  }

  const blocked: string[] = [];
  for (const p of plans) {
    const collides = p.collisions.reduce((s, c) => s + c.count, 0);
    const policy =
      collides === 0
        ? ""
        : DROP_LOSER_ON_COLLISION.has(p.table)
          ? `  (${collides} collision → delete drop-side row)`
          : `  (${collides} collision → BLOCKED, resolve manually)`;
    if (collides > 0 && !DROP_LOSER_ON_COLLISION.has(p.table)) {
      blocked.push(
        `${p.table}.${p.fkCol}: keep+drop both have rows matching unique (${p.collisions.map((c) => c.idxCols.join(", ")).join(" / ")})`,
      );
    }
    console.log(`  ${p.table}.${p.fkCol}: ${p.total} row(s) → re-parent${policy}`);
  }

  const moved = COALESCE_COLUMNS.filter(
    (c) => keep[c] == null && drop[c] != null,
  );
  if (moved.length > 0) {
    console.log(`\n  Columns copied to kept row: ${moved.map((c) => `${c}=${drop[c]}`).join("  ")}`);
  }

  if (blocked.length > 0) {
    console.log("\n✗ Merge blocked — resolve these manually, then re-run:");
    for (const b of blocked) console.log(`    ${b}`);
    process.exit(1);
  }

  if (!COMMIT) {
    console.log("\nDry run complete — no changes written.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Both rows have a DALIMember marker in every observed pair; keep the
    // survivor's but backfill its null onboarding/tour timestamps so the
    // merged user isn't pushed back through onboarding.
    const [keepMember, dropMember] = await Promise.all([
      tx.dALIMember.findUnique({ where: { userId: keepId } }),
      tx.dALIMember.findUnique({ where: { userId: dropId } }),
    ]);
    if (keepMember && dropMember) {
      await tx.dALIMember.update({
        where: { id: keepMember.id },
        data: {
          onboardedAt: keepMember.onboardedAt ?? dropMember.onboardedAt,
          tourCompletedAt: keepMember.tourCompletedAt ?? dropMember.tourCompletedAt,
        },
      });
    }

    for (const p of plans) {
      for (const c of p.collisions) {
        await tx.$executeRawUnsafe(
          `DELETE FROM ${q(p.table)} l
           WHERE ${collisionPredicate(p.table, p.fkCol, c.idxCols)}`,
          dropId,
          keepId,
        );
      }
      await tx.$executeRawUnsafe(
        `UPDATE ${q(p.table)} SET ${q(p.fkCol)} = $2 WHERE ${q(p.fkCol)} = $1`,
        dropId,
        keepId,
      );
    }

    if (moved.length > 0) {
      await tx.user.update({
        where: { id: dropId },
        data: Object.fromEntries(moved.map((c) => [c, null])),
      });
      await tx.user.update({
        where: { id: keepId },
        data: Object.fromEntries(moved.map((c) => [c, drop[c]])),
      });
    }

    await tx.user.delete({ where: { id: dropId } });
  });

  console.log(`\n✓ Merged ${dropId} into ${keepId} and deleted the duplicate row.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
