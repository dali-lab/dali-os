// Backfill script — BetterAuth Phase 0
//
// Populates the three new BetterAuth columns on the User table for all existing
// rows so that BetterAuth can use `email` as its canonical login identifier.
//
// Usage:
//   npx tsx prisma/scripts/backfill-betterauth-email.ts           # dry-run (no writes)
//   npx tsx prisma/scripts/backfill-betterauth-email.ts --apply   # write to DB
//   npx tsx prisma/scripts/backfill-betterauth-email.ts --apply --force-skip-collisions
//
// Safe to re-run: only touches rows where `email IS NULL` or `name = ''` or
// `emailVerified = false` — already-backfilled rows are skipped.

import { PrismaClient } from "../../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BATCH_SIZE = 500;
const NO_EMAIL_LIST_LIMIT = 50;

const apply = process.argv.includes("--apply");
const forceSkipCollisions = process.argv.includes("--force-skip-collisions");

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveCanonicalEmail(user: {
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
}): string | null {
  return user.daliEmail ?? user.dartmouthEmail ?? user.personalEmail ?? null;
}

function resolveName(user: {
  firstName: string;
  lastName: string;
}): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── Main ───────────────────────────────────────────────────────────────────

if (!apply) {
  console.log("=".repeat(60));
  console.log("[DRY RUN — no writes]");
  console.log("Re-run with --apply to commit changes to the database.");
  console.log("=".repeat(60));
  console.log("");
}

// Fetch all users. We only need the fields relevant to the backfill.
const allUsers = await prisma.user.findMany({
  select: {
    id: true,
    firstName: true,
    lastName: true,
    daliEmail: true,
    dartmouthEmail: true,
    personalEmail: true,
    email: true,
    emailVerified: true,
    name: true,
  },
});

console.log(`Total users in database: ${allUsers.length}`);
console.log("");

// ── Step 1: Classify each user ─────────────────────────────────────────────

type UserRow = (typeof allUsers)[number];

const noEmailUsers: UserRow[] = [];
const candidatesByEmail = new Map<string, UserRow[]>(); // canonical email → users that resolve to it

for (const user of allUsers) {
  const canonical = resolveCanonicalEmail(user);
  if (canonical === null) {
    noEmailUsers.push(user);
    continue;
  }
  const bucket = candidatesByEmail.get(canonical) ?? [];
  bucket.push(user);
  candidatesByEmail.set(canonical, bucket);
}

// ── Step 2: Detect collisions ──────────────────────────────────────────────
// A collision is when TWO OR MORE *different* users resolve to the same
// canonical email. (A single user resolving to the same email they already
// have set is fine — it's idempotent.)

type CollisionEntry = {
  email: string;
  users: Array<{ id: string; name: string }>;
};

const collisions: CollisionEntry[] = [];
const collidingUserIds = new Set<string>();

for (const [email, users] of candidatesByEmail.entries()) {
  if (users.length > 1) {
    collisions.push({
      email,
      users: users.map((u) => ({
        id: u.id,
        name: resolveName(u),
      })),
    });
    for (const u of users) {
      collidingUserIds.add(u.id);
    }
  }
}

// ── Step 3: Compute what needs to change ──────────────────────────────────

type PendingUpdate = {
  id: string;
  setEmail: string | null; // null = skip (collision or already set)
  setName: string | null;  // null = skip (already set)
  setEmailVerified: boolean | null; // null = skip (already true)
};

const pending: PendingUpdate[] = [];
let wouldSetEmail = 0;
let wouldSetName = 0;
let wouldSetEmailVerified = 0;

for (const user of allUsers) {
  if (noEmailUsers.some((u) => u.id === user.id)) {
    // No email candidate at all — nothing to do for email/emailVerified,
    // still handle name below.
  }

  const canonical = resolveCanonicalEmail(user);
  const fullName = resolveName(user);

  // email: backfill only if currently null and not a collision victim
  let setEmail: string | null = null;
  if (user.email === null && canonical !== null && !collidingUserIds.has(user.id)) {
    setEmail = canonical;
    wouldSetEmail++;
  }

  // name: backfill where currently the empty-string default
  let setName: string | null = null;
  if (user.name === "" && fullName !== "") {
    setName = fullName;
    wouldSetName++;
  }

  // emailVerified: flip to true for existing users being backfilled
  // (they pre-date BetterAuth and were already verified via Google/CAS).
  // Only flip rows currently false, and only if they have a canonical email
  // and are not a collision (i.e. they would receive a backfilled email).
  let setEmailVerified: boolean | null = null;
  if (!user.emailVerified && canonical !== null && !collidingUserIds.has(user.id)) {
    setEmailVerified = true;
    wouldSetEmailVerified++;
  }

  // Only include in pending if there's actually something to do
  if (setEmail !== null || setName !== null || setEmailVerified !== null) {
    pending.push({ id: user.id, setEmail, setName, setEmailVerified });
  }
}

// ── Step 4: Print summary ──────────────────────────────────────────────────

console.log("── Summary " + "─".repeat(50));
console.log(`  Total users:            ${allUsers.length}`);
console.log(`  Would set email:        ${wouldSetEmail}`);
console.log(`  Would set name:         ${wouldSetName}`);
console.log(`  Would set emailVerified:${wouldSetEmailVerified}`);
console.log(`  Collision count:        ${collisions.length}  (email not written for these users)`);
console.log(`  No-email count:         ${noEmailUsers.length}  (all three email columns null)`);
console.log("");

if (collisions.length > 0) {
  console.log("── Collisions (email skipped for these users) " + "─".repeat(15));
  for (const c of collisions) {
    console.log(`  ${c.email}`);
    for (const u of c.users) {
      console.log(`    → ${u.id}  ${u.name}`);
    }
  }
  console.log("");
}

if (noEmailUsers.length > 0) {
  const shown = noEmailUsers.slice(0, NO_EMAIL_LIST_LIMIT);
  console.log(
    `── No-email users (email left null — column is nullable) ` + "─".repeat(5)
  );
  for (const u of shown) {
    console.log(`  ${u.id}  ${resolveName(u) || "(no name)"}`);
  }
  if (noEmailUsers.length > NO_EMAIL_LIST_LIMIT) {
    console.log(`  … and ${noEmailUsers.length - NO_EMAIL_LIST_LIMIT} more (truncated)`);
  }
  console.log("");
}

// ── Step 5: Exit or apply ─────────────────────────────────────────────────

if (!apply) {
  console.log("=".repeat(60));
  console.log("[DRY RUN COMPLETE — no writes performed]");
  console.log("Re-run with --apply to commit changes to the database.");
  if (collisions.length > 0) {
    console.log(
      "NOTE: collisions were detected. Re-run with --apply --force-skip-collisions"
    );
    console.log(
      "to proceed anyway (collision users will be skipped, others written)."
    );
  }
  console.log("=".repeat(60));
  await prisma.$disconnect();
  process.exit(0);
}

// ── apply mode ─────────────────────────────────────────────────────────────

if (collisions.length > 0 && !forceSkipCollisions) {
  console.error("ERROR: Collisions detected. Aborting --apply without --force-skip-collisions.");
  console.error(
    `${collisions.length} canonical email(s) map to multiple users. ` +
      "Resolve the collisions manually, or re-run with --force-skip-collisions to " +
      "skip those users and write the rest."
  );
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`Applying backfill in batches of ${BATCH_SIZE}…`);

let updatedEmail = 0;
let updatedName = 0;
let updatedEmailVerified = 0;

const batches = chunk(pending, BATCH_SIZE);
for (let i = 0; i < batches.length; i++) {
  const batch = batches[i]!;
  console.log(`  Batch ${i + 1}/${batches.length} — ${batch.length} rows…`);

  await Promise.all(
    batch.map(async ({ id, setEmail, setName, setEmailVerified }) => {
      const data: Record<string, unknown> = {};
      if (setEmail !== null) data["email"] = setEmail;
      if (setName !== null) data["name"] = setName;
      if (setEmailVerified !== null) data["emailVerified"] = setEmailVerified;

      if (Object.keys(data).length === 0) return;

      await prisma.user.update({ where: { id }, data });

      if (setEmail !== null) updatedEmail++;
      if (setName !== null) updatedName++;
      if (setEmailVerified !== null) updatedEmailVerified++;
    })
  );
}

console.log("");
console.log("── Apply complete " + "─".repeat(43));
console.log(`  Rows updated (email):         ${updatedEmail}`);
console.log(`  Rows updated (name):          ${updatedName}`);
console.log(`  Rows updated (emailVerified): ${updatedEmailVerified}`);
if (collisions.length > 0) {
  console.log(`  Skipped (collision):          ${collidingUserIds.size} users across ${collisions.length} email(s)`);
}
console.log("");

await prisma.$disconnect();
