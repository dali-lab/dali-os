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
import { getDartmouthJwt } from "../../app/lib/dartmouth-jwt.js";
import {
  classifySignInReadiness,
  synthesizedAddress,
} from "../../app/lib/signin-readiness.js";

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

const COLUMNS = {
  id: true,
  netId: true,
  email: true,
  daliEmail: true,
  dartmouthEmail: true,
  personalEmail: true,
  firstName: true,
  lastName: true,
  // A partner invited but not yet joined legitimately has no canonical email:
  // nobody has claimed the account, and they arrive by invite link rather than
  // the code door. Without this the audit reports a working flow as a defect.
  partnerContact: { select: { id: true } },
} as const;

type UserRow = {
  id: string;
  netId: string | null;
  email: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
  firstName: string;
  lastName: string;
  partnerContact: { id: string } | null;
  emails: { address: string }[];
};

// The point of this audit is to show what you are about to deal with, which is
// most useful BEFORE the migration ships. So the alias table is optional: on a
// database that predates it we classify from the four User columns alone, which
// is enough to identify every locked-out row — an alias can only ever move a row
// from locked-out to ok, never the reverse.
let aliasTableExists = true;
let users: UserRow[];
try {
  users = await prisma.user.findMany({
    select: { ...COLUMNS, emails: { select: { address: true } } },
    orderBy: { createdAt: "asc" },
  });
} catch (err) {
  if ((err as { code?: string })?.code !== "P2021") throw err;
  aliasTableExists = false;
  const rows = await prisma.user.findMany({
    select: COLUMNS,
    orderBy: { createdAt: "asc" },
  });
  users = rows.map((r) => ({ ...r, emails: [] }));
}

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
// An un-joined partner has no canonical email by design. Counting them as
// broken buries the rows that genuinely are.
const pendingInvite = by("no-canonical").filter((a) => a.user.partnerContact !== null);
const noCanonical = by("no-canonical").filter((a) => a.user.partnerContact === null);
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

// Mixed case is silently fatal. BetterAuth's findUserByEmail runs
//   where: [{ value: email.toLowerCase(), field: "email" }]
// which is an exact match against a lowercased input, and Postgres compares
// case-sensitively — so a row storing Name.Surname.29@dartmouth.edu can never
// be found, however correct the address looks. The other columns are matched
// case-sensitively by our own resolution fallback for the same reason.
const mixedCase = assessed.filter((a) =>
  [a.user.email, a.user.daliEmail, a.user.dartmouthEmail, a.user.personalEmail].some(
    (v) => v !== null && v !== v.toLowerCase(),
  ),
);

function name(u: (typeof users)[number]): string {
  return `${u.firstName} ${u.lastName}`.trim() || u.id;
}

log("=".repeat(72));
log(
  fix && aliasTableExists
    ? "SIGN-IN READINESS  [--fix: will attach missing aliases]"
    : "SIGN-IN READINESS  [read-only]",
);
if (!aliasTableExists) {
  log("UserEmail does not exist yet — this is the PRE-MIGRATION picture.");
  log("Verdicts below are computed from the User columns alone, which is the");
  log("state every row is in today. Applying the migration changes none of");
  log("them by itself: it copies these same addresses across.");
}
log("=".repeat(72));
log();
log(`Users: ${users.length}`);
log(`  gets a code today ......... ${ok.length}`);
log(`  locked out ................ ${lockedOut.length}   only the synthesized netid address`);
log(`  no canonical email ........ ${noCanonical.length}   User.email is null; no code can be sent`);
log(`  partner invited, not joined  ${pendingInvite.length}   expected: no account claimed yet`);
log(`  no address at all ......... ${noAddress.length}   nothing to sign in with`);
log(`  address conflicts ......... ${conflicts.length}   one address, two accounts`);
log(`  mixed-case addresses ...... ${mixedCase.length}   unreachable: BetterAuth matches lowercase exactly`);
log();

const missing = aliasTableExists
  ? assessed.filter((a) => a.missingAliases.length > 0)
  : [];
if (aliasTableExists) {
  const aliasRows = assessed.reduce((n, a) => n + a.user.emails.length, 0);
  log(`UserEmail rows: ${aliasRows}`);
  log(`  rows missing an alias for a column they hold: ${missing.length}`);
  if (missing.length > 0 && !fix) {
    log(`  (--fix attaches them; the migration should have, so a non-zero count`);
    log(`   means a write path is still bypassing recordUserEmail)`);
  }
  log();
}

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

if (mixedCase.length > 0) {
  log("── Mixed-case addresses " + "─".repeat(47));
  log("   Stored with uppercase, so the lookup never matches. --fix lowercases.");
  // Which column it is decides the severity. `email` is the login identifier
  // BetterAuth looks up, so uppercase there means the account cannot be found
  // at all. The alias columns only feed our own fallback, and a miss there
  // falls through to the directory heal, which recovers it — annoying, not fatal.
  for (const a of mixedCase.slice(0, SAMPLE)) {
    const cols = (["email", "daliEmail", "dartmouthEmail", "personalEmail"] as const)
      .filter((c) => a.user[c] !== null && a.user[c] !== a.user[c]!.toLowerCase())
      .map((c) => `${c}=${a.user[c]}`);
    const fatal = a.user.email !== null && a.user.email !== a.user.email.toLowerCase();
    log(`   ${fatal ? "UNREACHABLE" : "alias only "}  ${name(a.user)}  ${cols.join("  ")}`);
  }
  if (mixedCase.length > SAMPLE) log(`   … and ${mixedCase.length - SAMPLE} more`);
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
  // Check credentials once rather than discovering the same failure 298 times.
  // DARTMOUTH_API_KEY is a Fly secret, so a local run has nothing to exchange.
  try {
    await getDartmouthJwt();
  } catch (err) {
    log("── Probe skipped " + "─".repeat(54));
    log(`   Cannot reach the People API: ${err instanceof Error ? err.message : String(err)}`);
    log();
    log("   DARTMOUTH_API_KEY lives in Fly secrets, not .env, so this needs to");
    log("   run where it exists:");
    log("     fly ssh console -a dali-api-prod");
    log();
    await prisma.$disconnect();
    process.exit(1);
  }

  log(`Asking the People API about ${lockedOut.length} locked-out rows…`);
  let repairable = 0;
  let sameAsSynthesized = 0;
  let noRecord = 0;
  const errors = new Map<string, number>();
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
          // Holding an address is not the same as holding a USABLE one. If
          // Dartmouth's record is the netid form as well, there is nothing to
          // attach that the row does not already have, and calling that
          // repairable promises a repair the sweep cannot perform.
          const synth = synthesizedAddress(a.user.netId);
          if (person?.email && person.email !== synth) {
            repairable++;
          } else if (person?.email) {
            sameAsSynthesized++;
            unfixable.push(a);
          } else {
            noRecord++;
            unfixable.push(a);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.set(message, (errors.get(message) ?? 0) + 1);
        }
      }
    }),
  );

  log();
  const errored = [...errors.values()].reduce((n, c) => n + c, 0);
  log("── Repairability " + "─".repeat(54));
  log(`   repairable by the sweep ... ${repairable}   a DIFFERENT address exists`);
  log(`   only the netid form ....... ${sameAsSynthesized}   <- Dartmouth knows no other address`);
  log(`   no address on file ........ ${noRecord}   <- need a different path`);
  log(`   lookup failed ............. ${errored}`);
  // A bare count is useless: one systemic failure and a few flaky ones look
  // identical. Name them.
  for (const [message, count] of [...errors].sort((a, b) => b[1] - a[1])) {
    log(`      ${String(count).padStart(5)}  ${message}`);
  }
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

if (fix && !aliasTableExists) {
  log("--fix ignored: UserEmail does not exist yet. Apply the migration first.");
  log();
}

if (fix && aliasTableExists && missing.length > 0) {
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

if (fix && mixedCase.length > 0) {
  log(`Lowercasing ${mixedCase.length} rows with mixed-case addresses…`);
  let fixed = 0;
  for (const a of mixedCase) {
    const data: Record<string, string> = {};
    for (const col of ["email", "daliEmail", "dartmouthEmail", "personalEmail"] as const) {
      const v = a.user[col];
      if (v !== null && v !== v.toLowerCase()) data[col] = v.toLowerCase();
    }
    try {
      await prisma.user.update({ where: { id: a.user.id }, data });
      fixed++;
    } catch (err) {
      // Unique violation: two rows differing only by case. A duplicate to
      // settle by hand, never to resolve by overwriting one of them.
      log(`   SKIP ${a.user.id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  log(`   lowercased: ${fixed}`);
  log();
}

log("── Next " + "─".repeat(63));
if (lockedOut.length > 0) {
  log(`   ${lockedOut.length} locked out. Sign-in self-heals on first attempt for anyone`);
  log(`   the People API knows, so they recover without this; run`);
  log(`   sweep-dartmouth-addresses.ts to repair them in bulk instead.`);
}
if (noCanonical.length > 0) {
  log(`   ${noCanonical.length} rows have no canonical email. Sign-in adopts the address`);
  log(`   Dartmouth attests, so these self-repair on first attempt PROVIDED the`);
  log(`   row carries a netId — that is how the owner is found. Rows without one`);
  log(`   need a human.`);
}
if (noAddress.length > 0) {
  log(`   ${noAddress.length} rows hold no address at all. Nothing automated applies.`);
}
if (mixedCase.length > 0) {
  log(`   ${mixedCase.length} rows store an address with uppercase and cannot be found at`);
  log(`   all until lowercased. Run --fix.`);
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
