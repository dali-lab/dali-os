import { prisma } from "~/lib/db";
import { cycleSortKeyRange } from "~/lib/core-cycle";

function getAdminUserIdsFromEnv(): string[] {
  return (process.env.ADMIN_USER_IDS ?? "").split(",").filter(Boolean);
}

// True if the userId is in ADMIN_USER_IDS env. Exported so list-view loaders
// can OR this into their per-row isAdmin/isCore derivation without paying
// per-row getUserRoles() round-trips.
export function isAdminViaEnv(userId: string): boolean {
  return getAdminUserIdsFromEnv().includes(userId);
}

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
  /** Core (current Spring-anchored cycle) or Admin. */
  isCore: boolean;
  isAdmin: boolean;
  isDomainLead: boolean;
  isInstructor: boolean;
  /**
   * Derived: this user has graduated and is no longer an active lab member.
   * See `isAlumni()` for the layered derivation (current-assignment guard →
   * People degree-conferral → graduatedAt → enrolled-override → classYear
   * + assignment history).
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
  const envIds = getAdminUserIdsFromEnv();

  const cycleTermIds = await getActiveCoreCycleTermIds();

  const [member, admin, core, domainLead, instructor, alumni] = await Promise.all([
    prisma.dALIMember.findUnique({ where: { userId }, select: { id: true } }),
    prisma.adminMembership.findUnique({ where: { userId }, select: { id: true } }),
    // Core access tracks the active election cycle (Spring N → Winter N+1,
    // with the prior cycle overlapping during Spring elections). An empty
    // Term table → no rows can match → treated as no Core access.
    cycleTermIds.length > 0
      ? prisma.coreAssignment.findFirst({
          where: { userId, termId: { in: cycleTermIds } },
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
 * Core (active Spring-anchored cycle) or Admin. Cycle = the most recent
 * Spring through the following Winter; during Spring elections, the prior
 * cycle remains active for the handoff. If the Term table is empty
 * (e.g. seed hasn't run), Admin is the only path that passes.
 */
export async function isCore(userId: string): Promise<boolean> {
  const envIds = getAdminUserIdsFromEnv();
  if (envIds.includes(userId)) return true;
  const admin = await prisma.adminMembership.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (admin !== null) return true;
  const cycleTermIds = await getActiveCoreCycleTermIds();
  if (cycleTermIds.length === 0) return false;
  const core = await prisma.coreAssignment.findFirst({
    where: { userId, termId: { in: cycleTermIds } },
    select: { id: true },
  });
  return core !== null;
}

/** Admin: full-time staff. */
export async function isAdmin(userId: string): Promise<boolean> {
  const envIds = getAdminUserIdsFromEnv();
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

/**
 * Strict variant of `currentTerm()`: returns the Term whose
 * [startDate, endDate] window contains now, or null if now falls in the
 * inter-term gap. No roll-forward to the next upcoming term. Use this when
 * the call site must fail closed between terms (e.g. intern eligibility).
 */
export async function currentTermStrict() {
  const now = new Date();
  return prisma.term.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    orderBy: { sortKey: "desc" },
  });
}

/**
 * Prisma `where` predicate for "current lab members" — Users with a DALIMember
 * row who are active in the current term. Use this in directory / picker
 * endpoints that should exclude alumni and applicants (e.g. calendar attendee
 * picker, announcements recipient picker, hiring reviewer/interviewer picker).
 *
 * "Active this term" matches the canonical Members page (`members.tsx`): a
 * CoreAssignment OR a project assignment for the current term. If there is no
 * current term at all (empty Term table), the predicate degrades to "any lab
 * member" rather than returning nothing.
 */
export async function currentTermMemberWhere() {
  const term = await currentTerm();
  if (!term) return { daliMember: { isNot: null } };
  return {
    daliMember: { isNot: null },
    OR: [
      { coreAssignments: { some: { termId: term.id } } },
      { projectAssignments: { some: { termId: term.id } } },
    ],
  };
}

/**
 * Term IDs that constitute the active Core cycle. Core is elected in
 * Spring and the cycle window spans `[Spring N, Spring N+1)` in sortKey
 * space.
 *
 * During a Spring term, the previous cycle is also active so an outgoing
 * Core keeps access through the election handoff (until the new cycle's
 * assignments take over the following Summer). Outside of Spring, the
 * helper just returns the current cycle's term ids — same set the
 * cycle-aware fan-out writes to CoreAssignment.
 *
 * Cycle math lives in `~/lib/core-cycle.ts` and is shared with the
 * add/remove writers so reads + writes can't drift.
 */
export async function getActiveCoreCycleTermIds(): Promise<string[]> {
  const term = await currentTerm();
  if (!term) return [];
  const currentRange = cycleSortKeyRange(term.sortKey);
  // Spring (digit 2) extends the window back one cycle for the handoff.
  const lowerBound = term.sortKey % 10 === 2 ? currentRange.gte - 10 : currentRange.gte;
  const terms = await prisma.term.findMany({
    where: { sortKey: { gte: lowerBound, lt: currentRange.lt } },
    select: { id: true },
  });
  return terms.map((t) => t.id);
}

// ─── Staffing-board access ───────────────────────────────────────────────────

/**
 * Allowed to read + modify the staffing board: any Core member (admins, or
 * anyone with a current-term CoreAssignment). Previously this was narrowed to
 * Core members whose leadTitle contained "staffing", but every Core member who
 * can view the board should also be able to manage it — same membership set as
 * `isCore`, so the board's view + mutate gates align.
 */
export async function canManageStaffing(userId: string): Promise<boolean> {
  return isCore(userId);
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

// Tier-3 enrolled-student override expires after this many days. If the
// People sync is older, we don't trust "still enrolled" to override classYear
// math — the member may have graduated and we just haven't refreshed. Must
// stay comfortably above the 7-day refresh cadence in dartmouth-refresh.ts
// or the override goes dark between syncs.
const ENROLLMENT_FRESHNESS_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the user is an alumnus — graduated and no longer active in the lab.
 *
 * Layered derivation (see alumni_plan.md "Observed API behavior" for why
 * each signal is trusted the way it is):
 *
 *   Tier 0: has a current-term assignment                → false (active is
 *           never alumni — protects staffed BE dual-degree candidates and
 *           fresh grads until their final term rolls off)
 *   Tier 1: People affiliations include "Alum" (degree conferred — appears
 *           within weeks) OR IDM code is ALUMNI (trails by months) → true
 *   Tier 2: explicit `graduatedAt` in the past           → true
 *   Tier 3: fresh sync + Student + NOT Alum              → false (enrolled —
 *           the +1 guard; "Student" alone lingers post-grad, the compound
 *           doesn't)
 *   Tier 4: classYear past Commencement + past assignment(s) → true
 *           (fallback for users with no netId / nothing synced)
 */
export async function isAlumni(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      classYear: true,
      graduatedAt: true,
      dartmouthAffiliation: true,
      dartmouthIsAlum: true,
      dartmouthIsStudent: true,
      dartmouthPeopleSyncedAt: true,
    },
  });
  if (!user) return false;

  const now = new Date();

  // Nothing points at alumni → done, without paying for assignment queries.
  // This is the common case for every current student.
  const hasPositiveSignal =
    user.dartmouthIsAlum === true ||
    user.dartmouthAffiliation === "ALUMNI" ||
    (user.graduatedAt !== null && user.graduatedAt < now) ||
    (user.classYear !== null && standardGradDate(user.classYear) <= now);
  if (!hasPositiveSignal) return false;

  // Tier 0: anyone holding a current-term assignment is never alumni,
  // whatever the directory says. A BE dual-degree candidate has their AB
  // conferred (Alum affiliation present) while still enrolled and staffed;
  // a fresh grad still holds their final-term assignment until rollover.
  const term = await currentTerm();
  if (term && (await hasAnyCurrentAssignment(userId, term.id))) return false;

  // Tier 1: degree conferred ("Alum" shows up within weeks of Commencement)
  // or the eventual IDM ALUMNI flip.
  if (user.dartmouthIsAlum === true || user.dartmouthAffiliation === "ALUMNI") {
    return true;
  }

  // Tier 2: explicit graduation date (off-cycle grads set manually, or
  // stamped by the refresh on the first observed graduation signal).
  if (user.graduatedAt && user.graduatedAt < now) return true;

  // Tier 3: enrolled override. Student AND NOT Alum is the only reliable
  // "currently enrolled" compound — protects +1 students whose classYear
  // math says graduated. The NOT-Alum half is already guaranteed here
  // (Tier 1 returned on any Alum signal). Sync must be fresh: a stale
  // record may predate an actual graduation.
  if (
    user.dartmouthIsStudent === true &&
    user.dartmouthPeopleSyncedAt &&
    now.getTime() - user.dartmouthPeopleSyncedAt.getTime() <
      ENROLLMENT_FRESHNESS_DAYS * DAY_MS
  ) {
    return false;
  }

  // Tier 4: classYear math + assignment history, for users with nothing
  // synced. Requires a past assignment so brand-new accounts with a stale
  // classYear don't read as alumni of a lab they never joined.
  if (!user.classYear) return false;
  if (standardGradDate(user.classYear) > now) return false;

  return hasAnyPastAssignment(userId, term?.id ?? null);
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
