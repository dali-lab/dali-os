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

  const [member, admin, core, domainLead, instructor] = await Promise.all([
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
