// Dartmouth address sweep — repairs rows whose only address is synthesized.
//
// CAS provisioning built dartmouthEmail from the NetID (f00xxxx@dartmouth.edu)
// and the BetterAuth cutover promoted that to the canonical User.email. It
// routes, so everything we SEND has always arrived — but no human knows it, so
// when the email-code door replaced CAS the address people actually type
// matched nothing and sign-in died silently. This attaches the real addresses.
//
// Source is the People API (api.dartmouth.edu/api/people/{netid}), whose base
// no-scope payload carries `email` — the person's real name-form address —
// alongside the affiliation signals we already read from it. No extra scope,
// no new integration: this is the endpoint the membership sync has used all
// along. The dry run still reports coverage against the locked-out set, since
// a record without an email is a row this cannot repair.
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
import { peopleByNetId } from "../../app/lib/dartmouth-people.js";
import { preferredCanonicalEmail } from "../../app/lib/signin-readiness.js";

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
    const person = await peopleByNetId(row.netId!);
    const found = person?.email ? [person.email] : [];
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
    for (const address of found) {
      if (held.has(address)) continue;
      const owner = await prisma.userEmail.findUnique({
        where: { address },
        select: { userId: true },
      });
      if (owner && owner.userId !== row.id) {
        conflicts.push({ address, ownerId: owner.userId });
      } else {
        newAddresses.push(address);
      }
    }

    // Promoting the address we synthesized ourselves would be a no-op, so it is
    // never the candidate.
    const preferred = found.find((a) => !isSynthesized(a, row.netId!)) ?? null;

    return { kind: "resolved", row, addresses: found, preferred, newAddresses, conflicts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", row, message };
  }
}

function canonicalFor(row: Row, preferred: string | null): string | null {
  return preferredCanonicalEmail({
    netId: row.netId,
    email: row.email,
    daliEmail: row.daliEmail,
    candidate: preferred,
  });
}

function norm(a: string | null): string | null {
  const t = a?.trim().toLowerCase();
  return t ? t : null;
}

/** Whether --promote has anything to change on this row. */
function promotionNeeded(outcome: Extract<Outcome, { kind: "resolved" }>): boolean {
  if (!promote) return false;
  const { row, preferred } = outcome;
  if (canonicalFor(row, preferred) !== null) return true;
  return (
    preferred !== null &&
    preferred.endsWith("@dartmouth.edu") &&
    norm(row.dartmouthEmail) !== preferred
  );
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

  if (!promote) return;

  const data: Record<string, string> = {};

  // dartmouthEmail is an alias column, not the login identifier, so it takes
  // the Dartmouth identity address whichever way the canonical goes.
  if (
    preferred !== null &&
    preferred.endsWith("@dartmouth.edu") &&
    norm(row.dartmouthEmail) !== preferred
  ) {
    data.dartmouthEmail = preferred;
  }

  const canonical = canonicalFor(row, preferred);
  if (canonical !== null) data.email = canonical;

  if (Object.keys(data).length === 0) return;

  // Every target column is @unique. Rather than pre-checking each one, let the
  // write fail: a collision means another account already claims the address,
  // which is a duplicate to settle by hand and never to force.
  try {
    await prisma.user.update({ where: { id: row.id }, data });
  } catch (err) {
    const fields = Object.entries(data)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    log(`  SKIP promote ${row.id}: ${fields} (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
  }
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
log(`Querying the People API (concurrency ${CONCURRENCY})…`);

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
log(`  ^ A low number here means those records carry no email, so the sweep`);
log(`    cannot repair them and they need a proof-based path instead.`);
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
  const promotable = resolved.filter(promotionNeeded);
  const restoring = resolved.filter(
    (o) => canonicalFor(o.row, o.preferred) === norm(o.row.daliEmail) && norm(o.row.daliEmail) !== null,
  );
  log(`  Canonical/alias updates: ${promotable.length}`);
  log(`    ...restoring a @dali canonical: ${restoring.length}`);
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
// Not just withNew: a row can already hold every alias and still need its
// canonical put back, which is exactly the state an earlier --promote run left
// members in. Visiting only rows gaining an alias would skip every one of them.
const toWrite = resolved.filter(
  (o) => o.newAddresses.length > 0 || promotionNeeded(o),
);
for (const outcome of toWrite) {
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
