// Backfill + account-linking — BetterAuth cutover
//
// See specs/betterauth-email-linking.md. Does two things, each gated:
//
//   1. Canonical `email` / `name` / `emailVerified` backfill   (--apply)
//        Legacy members have email=null and cannot log in passwordless until
//        this runs. Canonical email is @dali-first (Kiran, 2026-09-24).
//   2. Same-person duplicate consolidation                      (--merge)
//        Two rows that share a real address are the same person. Auto-merge
//        ONLY when the duplicate is a husk (auth/session rows only) so nothing
//        real is re-parented; two-real-data rows are flagged, never merged.
//
// Dartmouth-alias population (fill dartmouthEmail so a member's @dartmouth also
// resolves to their one account) is deliberately NOT here: the directory only
// resolves by name, and the safe path is to populate the alias lazily via
// proof-of-inbox when the login alias-resolver ships (piece #2). See the spec.
//
// Usage:
//   npx tsx prisma/scripts/backfill-betterauth-email.ts                  # dry-run
//   npx tsx prisma/scripts/backfill-betterauth-email.ts --apply          # write email/name/verified
//   npx tsx prisma/scripts/backfill-betterauth-email.ts --apply --merge  # + auto-merge husk duplicates
//   ... add --force-skip-collisions to write past same-email collisions
//
// Safe to re-run: only touches email=null / name='' / emailVerified=false rows
// and free unique columns; merges are transactional and fail safe to a flag.

import { PrismaClient } from "../../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  resolveCanonicalEmail,
  resolveName,
  groupBySharedAddress,
  isHusk,
  chooseSurvivor,
} from "../../app/lib/betterauth-linking.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BATCH_SIZE = 500;
const NO_EMAIL_LIST_LIMIT = 50;

const apply = process.argv.includes("--apply");
const doMerge = process.argv.includes("--merge");
const forceSkipCollisions = process.argv.includes("--force-skip-collisions");

// Content/work relations counted to decide husk-ness. Non-zero on ANY of these
// means the row carries real member work → NOT a husk → flagged, never merged.
// Auth-substrate relations (sessions, accounts, passkeys, oauth*, tokens,
// pairings) are deliberately excluded — they are what a husk legitimately has
// and are re-parented on merge. daliMember is handled specially. The stricter
// this list, the safer: a miss only causes the transactional delete below to
// throw and roll back, which flags the pair rather than losing data.
const HUSK_BUSINESS_RELATIONS = [
  "applications",
  "createdTasks",
  "taskAssignees",
  "taskComments",
  "projectAssignments",
  "coreAssignments",
  "instructorAssignments",
  "staffingAssignments",
  "staffingPreferences",
  "essentialityRatings",
  "timeEntries",
  "meetingAttendances",
  "scheduledMeetings",
  "mentorNotesAsMentor",
  "mentorNotesAsMentee",
  "mentorshipPairsAsMentee",
  "mentorshipPairsAsMentor",
  "createdPages",
  "lastEditedPages",
  "decisionsMade",
  "applicationReviewsSubmitted",
  "cycleReviewers",
  "cycleInterviewers",
  "formSubmissions",
  "formsCreated",
  "educationApplications",
  "educationSubmissions",
  "domainEligibilities",
  "signingSignatures",
  "authoredSigningVersions",
  "docComments",
  "receivedNotifications",
  "authoredNotifications",
] as const;

// Auth-substrate relations re-parented from a husk to its survivor on merge.
// Prisma delegate name → they all key off `userId`.
const REPARENT_DELEGATES = [
  "session",
  "oAuthSession",
  "authSession",
  "account",
  "passkey",
  "oneTimeToken",
  "devicePairing",
  "oAuthGrant",
  "gmailIntegration",
  "walletPassRegistration",
  "userCalendarLink",
] as const;

function log(msg = "") {
  console.log(msg);
}

// ── Husk classification ──────────────────────────────────────────────────────
// A row is a husk when it has no member work (business count 0) and is not an
// admin/partner account. daliMember does NOT disqualify — a freshly-created
// duplicate legitimately carries the marker.

async function classifyHusk(
  userId: string,
): Promise<{ husk: boolean; reason: string }> {
  const countSelect: Record<string, true> = {};
  for (const rel of HUSK_BUSINESS_RELATIONS) countSelect[rel] = true;

  const row = (await prisma.user.findUnique({
    where: { id: userId },
    select: {
      adminMembership: { select: { userId: true } },
      partnerUser: { select: { userId: true } },
      partnerContact: { select: { id: true } },
      // Dynamic relation list — cast past Prisma's exact-keys _count select type.
      _count: { select: countSelect as Record<string, boolean> },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as {
    adminMembership: { userId: string } | null;
    partnerUser: { userId: string } | null;
    partnerContact: { id: string } | null;
    _count: Record<string, number>;
  } | null;
  if (!row) return { husk: false, reason: "row vanished" };

  if (row.adminMembership) return { husk: false, reason: "has adminMembership" };
  if (row.partnerUser) return { husk: false, reason: "has partnerUser" };
  if (row.partnerContact) return { husk: false, reason: "has partnerContact" };

  const counts = row._count as Record<string, number>;
  const business = Object.entries(counts);
  const total = business.reduce((sum, [, n]) => sum + n, 0);
  if (!isHusk(total)) {
    const nonZero = business
      .filter(([, n]) => n > 0)
      .map(([rel, n]) => `${rel}=${n}`)
      .join(", ");
    return { husk: false, reason: `has work (${nonZero})` };
  }
  return { husk: true, reason: "auth/session only" };
}

// Merge a husk duplicate into its survivor, transactionally. Re-parents auth
// substrate, dedupes the DALIMember marker, deletes the husk (freeing its
// unique addresses), then absorbs the husk's addresses onto the survivor. Any
// leftover dependent row makes the delete throw → the whole txn rolls back and
// the caller flags the pair for manual handling. Nothing is lost.
async function mergeHuskIntoSurvivor(args: {
  survivorId: string;
  huskId: string;
  husk: {
    daliEmail: string | null;
    dartmouthEmail: string | null;
    personalEmail: string | null;
    netId: string | null;
  };
  survivor: {
    email: string | null;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    personalEmail: string | null;
    netId: string | null;
  };
}): Promise<void> {
  const { survivorId, huskId, husk, survivor } = args;
  await prisma.$transaction(async (tx) => {
    for (const delegate of REPARENT_DELEGATES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)[delegate].updateMany({
        where: { userId: huskId },
        data: { userId: survivorId },
      });
    }

    // DALIMember is one-per-user (unique). Keep the survivor's; drop the husk's.
    const survivorMember = await tx.dALIMember.findUnique({
      where: { userId: survivorId },
      select: { id: true },
    });
    if (survivorMember) {
      await tx.dALIMember.deleteMany({ where: { userId: huskId } });
    } else {
      await tx.dALIMember.updateMany({
        where: { userId: huskId },
        data: { userId: survivorId },
      });
    }

    // Delete the husk row — frees its unique address columns. Throws (→ rollback)
    // if any un-reparented dependent row remains, which is the safety net.
    await tx.user.delete({ where: { id: huskId } });

    // Absorb the husk's addresses/netId into the survivor's empty columns.
    const data: Record<string, string> = {};
    if (!survivor.daliEmail && husk.daliEmail) data.daliEmail = husk.daliEmail;
    if (!survivor.dartmouthEmail && husk.dartmouthEmail)
      data.dartmouthEmail = husk.dartmouthEmail;
    if (!survivor.personalEmail && husk.personalEmail)
      data.personalEmail = husk.personalEmail;
    if (!survivor.netId && husk.netId) data.netId = husk.netId;

    // Recompute canonical email if the survivor still lacks one.
    const merged = {
      daliEmail: data.daliEmail ?? survivor.daliEmail,
      dartmouthEmail: data.dartmouthEmail ?? survivor.dartmouthEmail,
      personalEmail: data.personalEmail ?? survivor.personalEmail,
    };
    if (!survivor.email) {
      const canonical = resolveCanonicalEmail(merged);
      if (canonical) data.email = canonical;
    }

    if (Object.keys(data).length > 0) {
      await tx.user.update({ where: { id: survivorId }, data });
    }
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!apply) {
  log("=".repeat(64));
  log("[DRY RUN — no writes]  Re-run with --apply to commit.");
  log(`  merge duplicates:  ${doMerge ? "yes (--merge)" : "no"}`);
  log("=".repeat(64));
  log();
}

const allUsers = await prisma.user.findMany({
  select: {
    id: true,
    createdAt: true,
    firstName: true,
    lastName: true,
    daliEmail: true,
    dartmouthEmail: true,
    personalEmail: true,
    email: true,
    emailVerified: true,
    netId: true,
    name: true,
  },
});

log(`Total users in database: ${allUsers.length}`);
log();

type UserRow = (typeof allUsers)[number];

// ── Step 1: canonical-email collisions (two DIFFERENT rows → same canonical) ──

const candidatesByEmail = new Map<string, UserRow[]>();
const noEmailUsers: UserRow[] = [];
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

const collidingUserIds = new Set<string>();
const collisions: Array<{ email: string; users: Array<{ id: string; name: string }> }> = [];
for (const [email, users] of candidatesByEmail.entries()) {
  if (users.length > 1) {
    collisions.push({ email, users: users.map((u) => ({ id: u.id, name: resolveName(u) })) });
    for (const u of users) collidingUserIds.add(u.id);
  }
}

// ── Step 2: compute email/name/emailVerified updates ─────────────────────────

type PendingUpdate = {
  id: string;
  setEmail: string | null;
  setName: string | null;
  setEmailVerified: boolean | null;
};
const pending: PendingUpdate[] = [];
let wouldSetEmail = 0;
let wouldSetName = 0;
let wouldSetEmailVerified = 0;

for (const user of allUsers) {
  const canonical = resolveCanonicalEmail(user);
  const fullName = resolveName(user);

  let setEmail: string | null = null;
  if (user.email === null && canonical !== null && !collidingUserIds.has(user.id)) {
    setEmail = canonical;
    wouldSetEmail++;
  }
  let setName: string | null = null;
  if (user.name === "" && fullName !== "") {
    setName = fullName;
    wouldSetName++;
  }
  let setEmailVerified: boolean | null = null;
  if (!user.emailVerified && canonical !== null && !collidingUserIds.has(user.id)) {
    setEmailVerified = true;
    wouldSetEmailVerified++;
  }
  if (setEmail !== null || setName !== null || setEmailVerified !== null) {
    pending.push({ id: user.id, setEmail, setName, setEmailVerified });
  }
}

// ── Step 3: same-person duplicates (share a real address) ────────────────────

const dupGroups = groupBySharedAddress(allUsers);

// ── Step 4: report ───────────────────────────────────────────────────────────

log("── Summary " + "─".repeat(54));
log(`  Total users:             ${allUsers.length}`);
log(`  Would set email:         ${wouldSetEmail}`);
log(`  Would set name:          ${wouldSetName}`);
log(`  Would set emailVerified: ${wouldSetEmailVerified}`);
log(`  Same-email collisions:   ${collisions.length}  (email not written for these)`);
log(`  No-email rows:           ${noEmailUsers.length}  (all address columns null)`);
log(`  Duplicate groups:        ${dupGroups.length}  (rows sharing a real address)`);
log();

if (collisions.length > 0) {
  log("── Same-email collisions (email skipped) " + "─".repeat(24));
  for (const c of collisions) {
    log(`  ${c.email}`);
    for (const u of c.users) log(`    → ${u.id}  ${u.name}`);
  }
  log();
}

if (noEmailUsers.length > 0) {
  log("── No-email rows (email left null) " + "─".repeat(30));
  for (const u of noEmailUsers.slice(0, NO_EMAIL_LIST_LIMIT)) {
    log(`  ${u.id}  ${resolveName(u) || "(no name)"}`);
  }
  if (noEmailUsers.length > NO_EMAIL_LIST_LIMIT) {
    log(`  … and ${noEmailUsers.length - NO_EMAIL_LIST_LIMIT} more (truncated)`);
  }
  log();
}

// ── Step 5: exit if dry-run ──────────────────────────────────────────────────

if (!apply) {
  // Classify duplicate groups so the dry-run shows what --merge WOULD do.
  if (dupGroups.length > 0) {
    log("── Duplicate groups (merge preview) " + "─".repeat(29));
    for (const group of dupGroups) {
      const classified = await Promise.all(
        group.map(async (row) => ({ row, ...(await classifyHusk(row.id)) })),
      );
      const decision = chooseSurvivor(
        classified.map((c) => ({ row: c.row, husk: c.husk })),
      );
      log(`  group: ${group.map((r) => resolveName(r) || r.id).join(" | ")}`);
      for (const c of classified) {
        log(`    ${c.husk ? "husk" : "KEEP"}  ${c.row.id}  ${resolveName(c.row)}  (${c.reason})`);
      }
      if (decision) {
        log(`    → auto-merge ${decision.duplicates.length} husk(s) into ${decision.survivor.id}`);
      } else {
        log(`    → FLAG for manual merge (real work on both sides)`);
      }
    }
    log();
  }
  log("=".repeat(64));
  log("[DRY RUN COMPLETE — no writes]");
  if (collisions.length > 0) log("NOTE: collisions detected. --apply --force-skip-collisions to skip them.");
  if (dupGroups.length > 0 && !doMerge) log("NOTE: add --merge to auto-merge husk duplicates.");
  log("=".repeat(64));
  await prisma.$disconnect();
  process.exit(0);
}

// ── Apply: email/name/emailVerified ──────────────────────────────────────────

if (collisions.length > 0 && !forceSkipCollisions) {
  console.error("ERROR: same-email collisions detected. Aborting --apply without --force-skip-collisions.");
  await prisma.$disconnect();
  process.exit(1);
}

log(`Applying email/name/emailVerified in batches of ${BATCH_SIZE}…`);
let updatedEmail = 0;
let updatedName = 0;
let updatedEmailVerified = 0;
for (let i = 0; i < pending.length; i += BATCH_SIZE) {
  const batch = pending.slice(i, i + BATCH_SIZE);
  await Promise.all(
    batch.map(async ({ id, setEmail, setName, setEmailVerified }) => {
      const data: Record<string, unknown> = {};
      if (setEmail !== null) data.email = setEmail;
      if (setName !== null) data.name = setName;
      if (setEmailVerified !== null) data.emailVerified = setEmailVerified;
      if (Object.keys(data).length === 0) return;
      await prisma.user.update({ where: { id }, data });
      if (setEmail !== null) updatedEmail++;
      if (setName !== null) updatedName++;
      if (setEmailVerified !== null) updatedEmailVerified++;
    }),
  );
}
log(`  email: ${updatedEmail}  name: ${updatedName}  emailVerified: ${updatedEmailVerified}`);
log();

// ── Apply: merge husk duplicates ─────────────────────────────────────────────

if (doMerge && dupGroups.length > 0) {
  log("Merging husk duplicates…");
  let merged = 0;
  let flagged = 0;
  for (const group of dupGroups) {
    const classified = await Promise.all(
      group.map(async (row) => ({ row, ...(await classifyHusk(row.id)) })),
    );
    const decision = chooseSurvivor(
      classified.map((c) => ({ row: c.row, husk: c.husk })),
    );
    if (!decision) {
      flagged++;
      log(`  FLAG (real work on both sides): ${group.map((r) => r.id).join(", ")}`);
      continue;
    }
    // Reload survivor addresses fresh (may have just been backfilled above).
    const survivorRow = await prisma.user.findUnique({
      where: { id: decision.survivor.id },
      select: { email: true, daliEmail: true, dartmouthEmail: true, personalEmail: true, netId: true },
    });
    if (!survivorRow) continue;
    for (const dup of decision.duplicates) {
      try {
        await mergeHuskIntoSurvivor({
          survivorId: decision.survivor.id,
          huskId: dup.id,
          husk: { daliEmail: dup.daliEmail, dartmouthEmail: dup.dartmouthEmail, personalEmail: dup.personalEmail, netId: dup.netId },
          survivor: survivorRow,
        });
        merged++;
        log(`  merged ${dup.id} → ${decision.survivor.id}`);
      } catch (err) {
        flagged++;
        log(`  FLAG (merge rolled back — dependent rows): ${dup.id} → ${decision.survivor.id}  [${(err as Error).message}]`);
      }
    }
  }
  log(`  merged: ${merged}  flagged for manual: ${flagged}`);
  log();
}

log("── Done " + "─".repeat(57));
await prisma.$disconnect();
