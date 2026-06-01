import { prisma } from "~/lib/db";

// Phase 2 rewrite: role flags derived from the new typed assignment tables
// (AdminMembership, CoreAssignment, DomainLeadAssignment) rather than the
// dropped DALIMember.roles[] enum. See V0_PLAN.md §"Identity model".
//
// API shape preserves field names where the value semantics still apply
// (`isCore`, `isAdmin`, `isDomainLead`) and renames `memberId` →
// `isLabMember` (boolean) since the new schema keys hiring FKs on userId
// directly — callers use `auth.user.sub` instead of indirecting through a
// DALIMember.id.

// ─── Bulk check (parallel queries) ───────────────────────────────────────────

export interface UserRoles {
  isLabMember: boolean;
  /** Core (current term) or Admin. */
  isCore: boolean;
  isAdmin: boolean;
  isDomainLead: boolean;
  isInstructor: boolean;
  /**
   * Derived: this user has graduated and is no longer an active lab member.
   * See `isAlumni()` for the layered derivation (People API → graduatedAt →
   * lookup negative-override → classYear + assignment history).
   */
  isAlumni: boolean;
  /** Forms & Groups: Core, Admin, or Instructor. */
  canViewForms: boolean;
  /** Staffing, Intent to Work, Bids, Applications: Core or Admin. */
  canViewStaffing: boolean;
}

/**
 * Resolve all role flags for a user with one round of parallel queries.
 * Use this in layout loaders instead of calling individual checks separately.
 */
export async function getUserRoles(userId: string): Promise<UserRoles> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);

  const term = await currentTerm();

  const [member, admin, core, domainLead, instructor, alumni] = await Promise.all([
    prisma.dALIMember.findUnique({ where: { userId }, select: { id: true } }),
    prisma.adminMembership.findUnique({ where: { userId }, select: { id: true } }),
    // Core access tracks the current term: a former Core member from a past
    // term shouldn't keep broad authority. If the Term table isn't seeded
    // (term === null), no row can match — treat that as no Core access.
    term
      ? prisma.coreAssignment.findFirst({
          where: { userId, termId: term.id },
          select: { id: true },
        })
      : Promise.resolve(null),
    // DomainLeadAssignment.termId is required post-Phase-2; any row signals
    // domain-lead authority for that user.
    prisma.domainLeadAssignment.findFirst({ where: { userId }, select: { id: true } }),
    // Any InstructorAssignment (any term) signals instructor authority —
    // mirrors the domain-lead "any row" convention.
    prisma.instructorAssignment.findFirst({ where: { userId }, select: { id: true } }),
    isAlumni(userId),
  ]);

  const isAdminVal = admin !== null || envIds.includes(userId);
  const isCoreVal = core !== null;
  const isInstructorVal = instructor !== null;

  // Alumni lose lab-member access on derivation; the DALIMember row stays
  // (we don't delete history) but `isLabMember` is the door used by route
  // guards, and a pure alumnus should not pass it.
  //
  // Admin/Core resolve from independent tables, so a former member who is
  // also flagged Admin (env-var or AdminMembership) or current-term Core
  // keeps active authority — derivation only suppresses access for a "pure"
  // alumnus with no current role. Domain-lead and instructor flags persist
  // any-term and shouldn't grant authority post-grad; zero them out here.
  const isAlumniVal = alumni;
  const pureAlumni = isAlumniVal && !isAdminVal && !isCoreVal;

  return {
    isLabMember: member !== null && !pureAlumni,
    // Admins are a superset of Core for access purposes.
    isCore: isAdminVal || isCoreVal,
    isAdmin: isAdminVal,
    isDomainLead: !pureAlumni && domainLead !== null,
    isInstructor: !pureAlumni && isInstructorVal,
    isAlumni: isAlumniVal,
    canViewForms:
      !pureAlumni && (isAdminVal || isCoreVal || isInstructorVal),
    canViewStaffing: isAdminVal || isCoreVal,
  };
}

// ─── Individual checks (for route-level guards) ──────────────────────────────

/**
 * Core (current term) or Admin. Past-term Core assignments do not count —
 * Core access is tied to the current Term. If the Term table is empty
 * (e.g. seed hasn't run), Admin is the only path that passes.
 */
export async function isCore(userId: string): Promise<boolean> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
  if (envIds.includes(userId)) return true;
  const admin = await prisma.adminMembership.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (admin !== null) return true;
  const term = await currentTerm();
  if (!term) return false;
  const core = await prisma.coreAssignment.findFirst({
    where: { userId, termId: term.id },
    select: { id: true },
  });
  return core !== null;
}

/** Admin: full-time staff. */
export async function isAdmin(userId: string): Promise<boolean> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
  if (envIds.includes(userId)) return true;
  const row = await prisma.adminMembership.findUnique({
    where: { userId },
    select: { id: true },
  });
  return row !== null;
}

/** Instructor: has at least one InstructorAssignment (any term). */
export async function isInstructor(userId: string): Promise<boolean> {
  const row = await prisma.instructorAssignment.findFirst({
    where: { userId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Forms & Groups gate: Core, Admin, or Instructor. (`isCore` already covers
 * Core + Admin; Instructors are added on top.)
 */
export async function canViewForms(userId: string): Promise<boolean> {
  if (await isCore(userId)) return true;
  return isInstructor(userId);
}

/**
 * Staffing / Intent to Work / Bids / Applications gate: Core or Admin.
 * Same membership set as `isCore` today — named separately so the staffing
 * access policy can diverge later.
 */
export async function canViewStaffing(userId: string): Promise<boolean> {
  return isCore(userId);
}

/** DomainLead: has at least one DomainLeadAssignment. */
export async function isDomainLead(userId: string): Promise<boolean> {
  const row = await prisma.domainLeadAssignment.findFirst({
    where: { userId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Whether the user is staffed on a project — a ProjectAssignment row for that
 * project in any term (past contributors keep access). Used to grant
 * content-edit access to the project hub; scope/domain settings stay Core/Admin.
 */
export async function isProjectMember(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const row = await prisma.projectAssignment.findFirst({
    where: { userId, projectId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Lab-membership gate. Returns the DALIMember row (thin marker — just
 * `{ id, userId, createdAt, updatedAt }`) if the user is a member, null
 * otherwise. The row is now a presence-only marker; callers should not
 * read display fields from it.
 */
export async function requireMember(userId: string) {
  return prisma.dALIMember.findUnique({ where: { userId } });
}

// ─── Term helper ─────────────────────────────────────────────────────────────

/**
 * Resolves the current Term. If now() falls between terms (e.g. the week
 * between Spring's endDate and Summer's startDate), returns the next
 * upcoming Term so role-checks don't briefly drop members to "Alumni".
 * Returns null only if the Term table is empty (i.e. v0-reference seed
 * hasn't run).
 */
export async function currentTerm() {
  const now = new Date();
  const active = await prisma.term.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    orderBy: { sortKey: "desc" },
  });
  if (active) return active;
  return prisma.term.findFirst({
    where: { startDate: { gt: now } },
    orderBy: { sortKey: "asc" },
  });
}

// ─── Staffing-board access ───────────────────────────────────────────────────

/**
 * Allowed to read + modify the staffing board: admins, or Core members whose
 * leadTitle implies staffing authority (we match the substring "staffing"
 * case-insensitively so titles like "Staffing Lead", "Staffing Coordinator",
 * "Co-Lead, Staffing" all qualify without us hardcoding strings).
 */
export async function canManageStaffing(userId: string): Promise<boolean> {
  if (await isAdmin(userId)) return true;
  const term = await currentTerm();
  if (!term) return false;
  const core = await prisma.coreAssignment.findFirst({
    where: {
      userId,
      termId: term.id,
      leadTitle: { contains: "staffing", mode: "insensitive" },
    },
    select: { id: true },
  });
  return core !== null;
}

// ─── Alumni derivation ───────────────────────────────────────────────────────

/** Dartmouth Commencement is mid-June each year. June 15 is the conservative
 * cutoff used for derived alumni status — a member with `classYear = 2026`
 * whose Dartmouth IDM record hasn't flipped yet is treated as alumni from
 * 2026-06-15 onward, provided they have no current-term assignments. */
export function standardGradDate(classYear: number): Date {
  // Date constructor month is 0-indexed.
  return new Date(classYear, 5, 15);
}

// Tier-3 lookup-Student override expires after this many days. If the lookup
// sync is older, we don't trust "still a Student" to override classYear math —
// the member may have graduated and we just haven't refreshed.
const LOOKUP_FRESHNESS_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the user is an alumnus — graduated and no longer active in the lab.
 *
 * Layered derivation, most-authoritative first (see alumni_plan.md):
 *
 *   Tier 1: People API says ALUMNI                       → true
 *   Tier 2: explicit `graduatedAt` is in the past        → true
 *   Tier 3: lookup says "still Student" (fresh sync)     → false (override)
 *   Tier 4: classYear past Commencement
 *           AND has past assignment(s)
 *           AND no current-term assignment               → true
 *
 * Tier 3 is the critical 5th-year-senior guard: a member with
 * `classYear = 2025` and an active 2026 spring assignment is *not* alumni
 * regardless of what the classYear math would say.
 */
export async function isAlumni(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      classYear: true,
      graduatedAt: true,
      dartmouthAffiliation: true,
      dartmouthLookupAffiliation: true,
      dartmouthLookupSyncedAt: true,
    },
  });
  if (!user) return false;

  // Tier 1: Dartmouth IDM has officially flipped the account to ALUMNI.
  if (user.dartmouthAffiliation === "ALUMNI") return true;

  const now = new Date();

  // Tier 2: explicit graduation date set (off-cycle grads, or stamped by
  // the People API the first time we observed ALUMNI).
  if (user.graduatedAt && user.graduatedAt < now) return true;

  // Tier 3: lookup-says-Student override. Protects 5th-year seniors whose
  // classYear is past but who are demonstrably still students per Dartmouth's
  // public directory. Sync must be fresh — a stale "Student" record may be
  // months-old reality that has since flipped.
  if (
    user.dartmouthLookupAffiliation === "Student" &&
    user.dartmouthLookupSyncedAt &&
    now.getTime() - user.dartmouthLookupSyncedAt.getTime() <
      LOOKUP_FRESHNESS_DAYS * DAY_MS
  ) {
    return false;
  }

  // Tier 4: classYear math + assignment history. Requires *both* a past
  // assignment AND zero current-term assignments — protects on-leave members
  // (no current assignment, but classYear still in the future) and
  // recently-staffed members from being miscategorized.
  if (!user.classYear) return false;
  if (standardGradDate(user.classYear) > now) return false;

  const term = await currentTerm();
  const [past, current] = await Promise.all([
    hasAnyPastAssignment(userId, term?.id ?? null),
    term ? hasAnyCurrentAssignment(userId, term.id) : Promise.resolve(false),
  ]);
  return past && !current;
}

// Past = any ProjectAssignment / CoreAssignment / InstructorAssignment /
// DomainLeadAssignment row outside the current term. If no current term is
// known, every row counts as past — this is the safer assumption (we'd
// rather correctly tier an alumnus when the Term table is empty than miss
// the tier flip entirely).
async function hasAnyPastAssignment(
  userId: string,
  currentTermId: string | null,
): Promise<boolean> {
  const excludeCurrent = currentTermId
    ? { NOT: { termId: currentTermId } }
    : {};
  const [proj, core, instr, lead] = await Promise.all([
    prisma.projectAssignment.findFirst({
      where: { userId, ...excludeCurrent },
      select: { id: true },
    }),
    prisma.coreAssignment.findFirst({
      where: { userId, ...excludeCurrent },
      select: { id: true },
    }),
    prisma.instructorAssignment.findFirst({
      where: { userId, ...excludeCurrent },
      select: { id: true },
    }),
    prisma.domainLeadAssignment.findFirst({
      where: { userId, ...excludeCurrent },
      select: { id: true },
    }),
  ]);
  return proj !== null || core !== null || instr !== null || lead !== null;
}

async function hasAnyCurrentAssignment(
  userId: string,
  termId: string,
): Promise<boolean> {
  const [proj, core, instr, lead] = await Promise.all([
    prisma.projectAssignment.findFirst({
      where: { userId, termId },
      select: { id: true },
    }),
    prisma.coreAssignment.findFirst({
      where: { userId, termId },
      select: { id: true },
    }),
    prisma.instructorAssignment.findFirst({
      where: { userId, termId },
      select: { id: true },
    }),
    prisma.domainLeadAssignment.findFirst({
      where: { userId, termId },
      select: { id: true },
    }),
  ]);
  return proj !== null || core !== null || instr !== null || lead !== null;
}

// ─── Tier resolution ─────────────────────────────────────────────────────────

export type Tier = "Admin" | "Core" | "Member" | "Alumni" | "Student" | "Partner";

/**
 * Resolve a user's single canonical tier. Order matches expansion_plan.md §347:
 *
 *   AdminMembership                      → Admin
 *   CoreAssignment(current term)         → Core
 *   any current-term assignment          → Member
 *   past assignments, no current         → Alumni
 *   PartnerUser                          → Partner
 *   none of the above                    → Student
 *
 * The MemberPendingSetup sub-tier from the plan is deferred — when setup-gating
 * lands, fold it in between the assignment and Alumni branches.
 */
export async function tier(userId: string): Promise<Tier> {
  if (await isAdmin(userId)) return "Admin";
  if (await isCore(userId)) return "Core";

  const term = await currentTerm();
  const hasCurrent = term
    ? await hasAnyCurrentAssignment(userId, term.id)
    : false;
  if (hasCurrent) return "Member";

  if (await isAlumni(userId)) return "Alumni";

  const partner = await prisma.partnerUser.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (partner !== null) return "Partner";

  return "Student";
}

// ─── Cycle-scoped access ─────────────────────────────────────────────────────

/**
 * Check whether a user may read cycle-scoped hiring data.
 * Core (current term) and domain leads pass immediately. Other lab members
 * pass only if they are a CycleReviewer or CycleInterviewer for the cycle.
 */
export async function hasCycleAccess(userId: string, cycleId: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (roles.isCore || roles.isDomainLead) return true;
  if (!roles.isLabMember) return false;

  const [reviewer, interviewer] = await Promise.all([
    prisma.cycleReviewer.findFirst({
      where: { userId, applicationCycleId: cycleId },
      select: { id: true },
    }),
    prisma.cycleInterviewer.findFirst({
      where: { userId, applicationCycleId: cycleId },
      select: { id: true },
    }),
  ]);
  return reviewer !== null || interviewer !== null;
}
