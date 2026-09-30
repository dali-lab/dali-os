// Dartmouth address sweep — repairs rows whose only address is synthesized.
//
// CAS provisioning built dartmouthEmail from the NetID (f00xxxx@dartmouth.edu)
// and the BetterAuth cutover promoted that to the canonical User.email. It
// routes, so everything we SEND has always arrived — but no human knows it, so
// when the email-code door replaced CAS the address people actually type
// matched nothing and sign-in died silently. This attaches the real addresses.
//
// Source is the Dartmouth Email Addresses API, keyed by netid. Note the two
// caveats in dartmouth-email-addresses.ts: it needs the
// urn:dartmouth:email_addresses:read.adv scope, and only the Advancement data
// source is live, which may not cover current students. The dry run reports
// per-netid coverage precisely so that question gets an answer from data
// rather than a guess — run it before trusting any of this.
//
// Usage:
//   npx tsx prisma/scripts/sweep-dartmouth-addresses.ts                  # dry run
//   npx tsx prisma/scripts/sweep-dartmouth-addresses.ts --apply          # write aliases
//   npx tsx prisma/scripts/sweep-dartmouth-addresses.ts --apply --promote
//
// --apply   attaches every address the API returns as a resolvable UserEmail.
//           Additive and idempotent: safe to re-run, never removes an alias,
//           never clears proof, never takes an address off another account.
// --promote additionally makes the preferred address canonical (User.email and
//           dartmouthEmail), so the person is shown and mailed the address they
//           recognise. Separate flag because it rewrites the BetterAuth login
//           identifier on live rows, while --apply alone already fixes sign-in.

import { PrismaClient } from "../../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  emailAddressesByNetId,
  DartmouthEmailApiError,
} from "../../app/lib/dartmouth-email-addresses.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const apply = process.argv.includes("--apply");
const promote = process.argv.includes("--promote");

// Concurrency against Dartmouth's API. Deliberately small: this is a one-off
// repair over a few thousand rows, and being slow is free.
const CONCURRENCY = 4;
const SAMPLE_LIMIT = 15;

function log(msg = "") {
  console.log(msg);
}

function isSynthesized(address: string | null, netId: string): boolean {
  return address !== null && address.toLowerCase() === `${netId}@dartmouth.edu`;
}

type Row = {
  id: string;
  netId: string | null;
  email: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  firstName: string;
  lastName: string;
};

type Outcome =
  | { kind: "no-addresses"; row: Row }
  | { kind: "error"; row: Row; message: string }
  | {
      kind: "resolved";
      row: Row;
      addresses: string[];
      preferred: string | null;
      /** Addresses not already held by this user. */
      newAddresses: string[];
      conflicts: { address: string; ownerId: string }[];
    };

async function classify(row: Row): Promise<Outcome> {
  try {
    const found = await emailAddressesByNetId(row.netId!);
    if (found.length === 0) return { kind: "no-addresses", row };

    const held = new Set(
      (
        await prisma.userEmail.findMany({
          where: { userId: row.id },
          select: { address: true },
        })
      ).map((e) => e.address),
    );

    const newAddresses: string[] = [];
    const conflicts: { address: string; ownerId: string }[] = [];
    for (const entry of found) {
      if (held.has(entry.address)) continue;
      const owner = await prisma.userEmail.findUnique({
        where: { address: entry.address },
        select: { userId: true },
      });
      if (owner && owner.userId !== row.id) {
        conflicts.push({ address: entry.address, ownerId: owner.userId });
      } else {
        newAddresses.push(entry.address);
      }
    }

    // Prefer Dartmouth's own preferred marker; fall back to the first address
    // that isn't the one we synthesized, since promoting that would be a no-op.
    const preferred =
      found.find((e) => e.preferred)?.address ??
      found.find((e) => !isSynthesized(e.address, row.netId!))?.address ??
      null;

    return {
      kind: "resolved",
      row,
      addresses: found.map((e) => e.address),
      preferred,
      newAddresses,
      conflicts,
    };
  } catch (err) {
    const message =
      err instanceof DartmouthEmailApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { kind: "error", row, message };
  }
}

async function writeOutcome(outcome: Extract<Outcome, { kind: "resolved" }>) {
  const { row, newAddresses, preferred } = outcome;

  for (const address of newAddresses) {
    // Unproven: the API attests where mail lands, it does not show anyone read
    // it. Proof is set when a code sent to the address is actually used.
    await prisma.userEmail.create({
      data: { userId: row.id, address, verifiedAt: null },
    });
  }

  if (!promote || preferred === null) return;
  if (row.email?.toLowerCase() === preferred) return;

  // Only promote onto columns that are free. Both are @unique, and a collision
  // means another row already claims the address — a duplicate account, which
  // this script reports rather than resolves.
  const clash = await prisma.user.findFirst({
    where: { AND: [{ id: { not: row.id } }, { OR: [{ email: preferred }, { dartmouthEmail: preferred }] }] },
    select: { id: true },
  });
  if (clash) {
    log(`  SKIP promote ${row.id}: ${preferred} already on user ${clash.id}`);
    return;
  }

  await prisma.user.update({
    where: { id: row.id },
    data: {
      email: preferred,
      // dartmouthEmail returns to meaning the person's Dartmouth IDENTITY
      // address. The synthesized NetID form stays in UserEmail, where it still
      // resolves at sign-in but is never displayed or mailed.
      ...(preferred.endsWith("@dartmouth.edu") ? { dartmouthEmail: preferred } : {}),
    },
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!apply) {
  log("=".repeat(70));
  log("[DRY RUN — no writes]  Re-run with --apply to attach addresses.");
  log(`  promote preferred to canonical: ${promote ? "yes (--promote)" : "no"}`);
  log("=".repeat(70));
  log();
}

const rows: Row[] = await prisma.user.findMany({
  where: { netId: { not: null } },
  select: {
    id: true,
    netId: true,
    email: true,
    daliEmail: true,
    dartmouthEmail: true,
    firstName: true,
    lastName: true,
  },
  orderBy: { createdAt: "asc" },
});

// The population this exists for: a row whose canonical address is the one we
// invented. Reported separately so coverage is measured against the people who
// are actually locked out, not against every row that happens to have a netId.
const synthesized = rows.filter(
  (r) => isSynthesized(r.email, r.netId!) || isSynthesized(r.dartmouthEmail, r.netId!),
);

log(`Users with a netId:                 ${rows.length}`);
log(`  ...whose address is synthesized:  ${synthesized.length}  <- the locked-out set`);
log();
log(`Querying the Email Addresses API (concurrency ${CONCURRENCY})…`);

const outcomes: Outcome[] = [];
const queue = [...rows];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      outcomes.push(await classify(row));
    }
  }),
);

const resolved = outcomes.filter(
  (o): o is Extract<Outcome, { kind: "resolved" }> => o.kind === "resolved",
);
const empty = outcomes.filter((o) => o.kind === "no-addresses");
const errored = outcomes.filter(
  (o): o is Extract<Outcome, { kind: "error" }> => o.kind === "error",
);

const synthesizedIds = new Set(synthesized.map((r) => r.id));
const resolvedLockedOut = resolved.filter((o) => synthesizedIds.has(o.row.id));

log();
log("── Coverage " + "─".repeat(58));
log(`  Returned ≥1 address:   ${resolved.length}`);
log(`  Returned none:         ${empty.length}`);
log(`  Errored:               ${errored.length}`);
log();
log(`  Of the ${synthesized.length} locked-out rows, ${resolvedLockedOut.length} got a real address.`);
log(`  ^ This is the number that decides whether the adv data source covers`);
log(`    current students. A low number here means the sweep cannot fix them`);
log(`    and they need the sis/idm sources, or a proof-based path instead.`);
log();

if (errored.length > 0) {
  log("── Errors " + "─".repeat(60));
  const byMessage = new Map<string, number>();
  for (const e of errored) byMessage.set(e.message, (byMessage.get(e.message) ?? 0) + 1);
  for (const [message, count] of [...byMessage].sort((a, b) => b[1] - a[1])) {
    log(`  ${count.toString().padStart(5)}  ${message}`);
  }
  log();
}

const withNew = resolved.filter((o) => o.newAddresses.length > 0);
const withConflicts = resolved.filter((o) => o.conflicts.length > 0);

log("── Changes " + "─".repeat(59));
log(`  Rows gaining an alias:   ${withNew.length}`);
log(`  Aliases to attach:       ${withNew.reduce((n, o) => n + o.newAddresses.length, 0)}`);
log(`  Address conflicts:       ${withConflicts.length}  (held by another account — reported, never moved)`);
if (promote) {
  const promotable = resolved.filter(
    (o) => o.preferred !== null && o.row.email?.toLowerCase() !== o.preferred,
  );
  log(`  Canonical promotions:    ${promotable.length}`);
}
log();

if (withNew.length > 0) {
  log("── Sample " + "─".repeat(60));
  for (const o of withNew.slice(0, SAMPLE_LIMIT)) {
    const name = `${o.row.firstName} ${o.row.lastName}`.trim() || o.row.id;
    log(`  ${o.row.netId}  ${name}`);
    log(`    have: ${o.row.email ?? "(none)"}`);
    log(`    add:  ${o.newAddresses.join(", ")}${o.preferred ? `   preferred: ${o.preferred}` : ""}`);
  }
  if (withNew.length > SAMPLE_LIMIT) log(`  … and ${withNew.length - SAMPLE_LIMIT} more`);
  log();
}

if (withConflicts.length > 0) {
  log("── Conflicts (two accounts, one mailbox) " + "─".repeat(29));
  for (const o of withConflicts.slice(0, SAMPLE_LIMIT)) {
    for (const c of o.conflicts) {
      log(`  ${c.address}  wanted by ${o.row.id}, held by ${c.ownerId}`);
    }
  }
  log();
}

if (!apply) {
  log("=".repeat(70));
  log("[DRY RUN COMPLETE — no writes]");
  log("=".repeat(70));
  await prisma.$disconnect();
  process.exit(0);
}

log("Applying…");
let attached = 0;
for (const outcome of withNew) {
  try {
    await writeOutcome(outcome);
    attached += outcome.newAddresses.length;
  } catch (err) {
    log(`  FAILED ${outcome.row.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
log(`  aliases attached: ${attached}`);
log();
log("── Done " + "─".repeat(62));
await prisma.$disconnect();
