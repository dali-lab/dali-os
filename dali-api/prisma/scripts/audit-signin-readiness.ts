// Sign-in readiness audit — who gets in, who doesn't, and what would fix them.
//
// Answers one question for every existing row: if this person goes to /login
// and types the address they know, do they get a code?
//
// Resolution reduces to two facts, so this needs no network to answer:
//   1. BetterAuth finds an account only by User.email. A null there means no
//      code can ever be sent, whatever aliases the row carries.
//   2. The address a person types has to be one we hold. The netid form
//      (f00xxxx@dartmouth.edu) does not count — CAS synthesized it, it delivers,
//      and nobody knows it. A row whose only address is that one is locked out
//      even though everything we have ever SENT them arrived.
//
// Read-only by default. --fix repairs only what is knowable locally; --probe
// asks Dartmouth whether the locked-out rows can be repaired at all.
//
// Usage:
//   npx tsx prisma/scripts/audit-signin-readiness.ts           # report
//   npx tsx prisma/scripts/audit-signin-readiness.ts --probe   # + ask Dartmouth
//   npx tsx prisma/scripts/audit-signin-readiness.ts --fix     # + attach aliases
//
// --fix   ensures every address already on a User row exists in UserEmail.
//         The introducing migration backfills this, so it should be a no-op —
//         it catches rows written by a code path that has not been updated, and
//         re-running it is safe.
// --probe queries the People API for the locked-out set. This is the number
//         that says whether the sweep can fix them; rows with no address on
//         file there need a different path and should be listed for a human.

import { PrismaClient } from "../../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { peopleByNetId } from "../../app/lib/dartmouth-people.js";
import { classifySignInReadiness } from "../../app/lib/signin-readiness.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const fix = process.argv.includes("--fix");
const probe = process.argv.includes("--probe");
const SAMPLE = 12;
const CONCURRENCY = 4;

function log(msg = "") {
  console.log(msg);
}

function norm(a: string | null): string | null {
  const t = a?.trim().toLowerCase();
  return t ? t : null;
}

const users = await prisma.user.findMany({
  select: {
    id: true,
    netId: true,
    email: true,
    daliEmail: true,
    dartmouthEmail: true,
    personalEmail: true,
    firstName: true,
    lastName: true,
    emails: { select: { address: true, verifiedAt: true } },
  },
  orderBy: { createdAt: "asc" },
});

type Assessed = ReturnType<typeof classifySignInReadiness> & {
  user: (typeof users)[number];
};

const assessed: Assessed[] = users.map((u) => ({
  user: u,
  ...classifySignInReadiness({
    netId: u.netId,
    email: u.email,
    daliEmail: u.daliEmail,
    dartmouthEmail: u.dartmouthEmail,
    personalEmail: u.personalEmail,
    aliases: u.emails.map((e) => e.address),
  }),
}));

const by = (v: Assessed["verdict"]) => assessed.filter((a) => a.verdict === v);
const ok = by("ok");
const lockedOut = by("locked-out");
const noCanonical = by("no-canonical");
const noAddress = by("no-address");

// One address must belong to one person; UserEmail enforces it going forward,
// but the User columns predate that and can still disagree.
const owners = new Map<string, string[]>();
for (const a of assessed) {
  for (const addr of [
    a.user.email,
    a.user.daliEmail,
    a.user.dartmouthEmail,
    a.user.personalEmail,
  ]
    .map(norm)
    .filter((x): x is string => x !== null)) {
    owners.set(addr, [...(owners.get(addr) ?? []), a.user.id]);
  }
}
const conflicts = [...owners.entries()].filter(([, ids]) => new Set(ids).size > 1);

function name(u: (typeof users)[number]): string {
  return `${u.firstName} ${u.lastName}`.trim() || u.id;
}

log("=".repeat(72));
log(fix ? "SIGN-IN READINESS  [--fix: will attach missing aliases]" : "SIGN-IN READINESS  [read-only]");
log("=".repeat(72));
log();
log(`Users: ${users.length}`);
log(`  gets a code today ......... ${ok.length}`);
log(`  locked out ................ ${lockedOut.length}   only the synthesized netid address`);
log(`  no canonical email ........ ${noCanonical.length}   User.email is null; no code can be sent`);
log(`  no address at all ......... ${noAddress.length}   nothing to sign in with`);
log(`  address conflicts ......... ${conflicts.length}   one address, two accounts`);
log();

const aliasRows = assessed.reduce((n, a) => n + a.user.emails.length, 0);
const missing = assessed.filter((a) => a.missingAliases.length > 0);
log(`UserEmail rows: ${aliasRows}`);
log(`  rows missing an alias for a column they hold: ${missing.length}`);
if (missing.length > 0 && !fix) {
  log(`  (--fix attaches them; the migration should have, so a non-zero count`);
  log(`   means a write path is still bypassing recordUserEmail)`);
}
log();

if (lockedOut.length > 0) {
  log("── Locked out " + "─".repeat(57));
  log("   These people can only be reached at an address they do not know.");
  for (const a of lockedOut.slice(0, SAMPLE)) {
    log(`   ${a.user.netId ?? "(no netid)"}  ${name(a.user)}  canonical=${a.user.email}`);
  }
  if (lockedOut.length > SAMPLE) log(`   … and ${lockedOut.length - SAMPLE} more`);
  log();
}

if (noCanonical.length > 0) {
  log("── No canonical email " + "─".repeat(49));
  log("   Aliases cannot help: resolution returns User.email, which is null.");
  for (const a of noCanonical.slice(0, SAMPLE)) {
    log(`   ${a.user.id}  ${name(a.user)}  holds: ${a.human.join(", ") || "(nothing)"}`);
  }
  if (noCanonical.length > SAMPLE) log(`   … and ${noCanonical.length - SAMPLE} more`);
  log();
}

if (conflicts.length > 0) {
  log("── Address conflicts " + "─".repeat(50));
  for (const [addr, ids] of conflicts.slice(0, SAMPLE)) {
    log(`   ${addr}  ->  ${[...new Set(ids)].join(", ")}`);
  }
  if (conflicts.length > SAMPLE) log(`   … and ${conflicts.length - SAMPLE} more`);
  log();
}

// ── Probe: can Dartmouth actually repair the locked-out set? ─────────────────

if (probe && lockedOut.length > 0) {
  log(`Asking the People API about ${lockedOut.length} locked-out rows…`);
  let repairable = 0;
  let noRecord = 0;
  let errored = 0;
  const unfixable: Assessed[] = [];

  const queue = [...lockedOut];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const a = queue.shift();
        if (!a) return;
        if (!a.user.netId) {
          noRecord++;
          unfixable.push(a);
          continue;
        }
        try {
          const person = await peopleByNetId(a.user.netId);
          if (person?.email) repairable++;
          else {
            noRecord++;
            unfixable.push(a);
          }
        } catch {
          errored++;
        }
      }
    }),
  );

  log();
  log("── Repairability " + "─".repeat(54));
  log(`   repairable by the sweep ... ${repairable}`);
  log(`   no address on file ........ ${noRecord}   <- need a different path`);
  log(`   lookup failed ............. ${errored}`);
  if (unfixable.length > 0) {
    log();
    log("   Not repairable automatically:");
    for (const a of unfixable.slice(0, SAMPLE)) {
      log(`   ${a.user.netId ?? "(no netid)"}  ${name(a.user)}  ${a.user.id}`);
    }
    if (unfixable.length > SAMPLE) log(`   … and ${unfixable.length - SAMPLE} more`);
  }
  log();
}

// ── Fix: attach aliases we already know about ───────────────────────────────

if (fix && missing.length > 0) {
  log(`Attaching ${missing.reduce((n, a) => n + a.missingAliases.length, 0)} missing aliases…`);
  let attached = 0;
  let skipped = 0;
  for (const a of missing) {
    for (const address of a.missingAliases) {
      const owner = await prisma.userEmail.findUnique({
        where: { address },
        select: { userId: true },
      });
      if (owner && owner.userId !== a.user.id) {
        // Never move an address between accounts: it would hand one person's
        // mail to the other. Reported above as a conflict for a human to settle.
        log(`   SKIP ${address}: held by ${owner.userId}, not ${a.user.id}`);
        skipped++;
        continue;
      }
      if (owner) continue;
      await prisma.userEmail.create({
        data: { userId: a.user.id, address, verifiedAt: null },
      });
      attached++;
    }
  }
  log(`   attached: ${attached}  skipped: ${skipped}`);
  log();
}

log("── Next " + "─".repeat(63));
if (lockedOut.length > 0) {
  log(`   ${lockedOut.length} locked out. Sign-in self-heals on first attempt for anyone`);
  log(`   the People API knows, so they recover without this; run`);
  log(`   sweep-dartmouth-addresses.ts to repair them in bulk instead.`);
}
if (noCanonical.length > 0 || noAddress.length > 0) {
  log(`   ${noCanonical.length + noAddress.length} rows cannot sign in by code at all and no`);
  log(`   automated repair applies — these need a decision, not a script.`);
}
if (conflicts.length > 0) {
  log(`   ${conflicts.length} address conflicts are duplicate accounts; merging is`);
  log(`   deliberately out of scope here (see app/lib/linking.ts).`);
}
if (lockedOut.length === 0 && noCanonical.length === 0 && conflicts.length === 0) {
  log("   Nothing to do — every row can reach its account.");
}
log();

await prisma.$disconnect();
