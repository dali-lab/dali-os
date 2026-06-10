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
  /** Core (current Spring-anchored cycle) or Admin. */
  isCore: boolean;
  isAdmin: boolean;
  isDomainLead: boolean;
  isInstructor: boolean;
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

  const cycleTermIds = await getActiveCoreCycleTermIds();

  const [member, admin, core, domainLead, instructor] = await Promise.all([
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
  ]);

  const isAdminVal = admin !== null || envIds.includes(userId);
  const isCoreVal = core !== null;
  const isInstructorVal = instructor !== null;

  return {
    isLabMember: member !== null,
    // Admins are a superset of Core for access purposes.
    isCore: isAdminVal || isCoreVal,
    isAdmin: isAdminVal,
    isDomainLead: domainLead !== null,
    isInstructor: isInstructorVal,
    canViewForms: isAdminVal || isCoreVal || isInstructorVal,
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
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
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
 * Spring sortKey at or before `sk`. A Core "cycle" runs from one Spring
 * election (W=1, S=2, X=3, F=4) through the following Winter, so the
 * cycle that contains a term is anchored by its preceding Spring. Winter
 * (digit 1) belongs to the previous calendar year's Spring cycle.
 */
function cycleStartSortKey(sk: number): number {
  const seasonDigit = sk % 10;
  return seasonDigit === 1 ? sk - 9 : sk - seasonDigit + 2;
}

/**
 * Term IDs that constitute the active Core cycle. Core is elected in
 * Spring and auto-rolls over through the following Winter; the cycle
 * window spans `[Spring N, Spring N+1)` in sortKey space.
 *
 * During a Spring term, the previous cycle is also active so an outgoing
 * Core keeps access through the election handoff (until they're either
 * re-elected, or replaced — at which point the new cycle's assignments
 * become the active set the following Summer).
 */
export async function getActiveCoreCycleTermIds(): Promise<string[]> {
  const term = await currentTerm();
  if (!term) return [];
  const cycleStart = cycleStartSortKey(term.sortKey);
  // Spring (digit 2) extends the window back one cycle for the handoff.
  const lowerBound = term.sortKey % 10 === 2 ? cycleStart - 10 : cycleStart;
  const upperBound = cycleStart + 10;
  const terms = await prisma.term.findMany({
    where: { sortKey: { gte: lowerBound, lt: upperBound } },
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
