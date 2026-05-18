import { prisma } from "~/lib/db";

// Phase 2 rewrite: role flags derived from the new typed assignment tables
// (AdminMembership, CoreAssignment, DomainLeadAssignment) rather than the
// dropped DALIMember.roles[] enum. See V0_PLAN.md §"Identity model".
//
// API shape preserves field names where the value semantics still apply
// (`isHiringLead`, `isAdmin`, `isDomainLead`) and renames `memberId` →
// `isLabMember` (boolean) since the new schema keys hiring FKs on userId
// directly — callers use `auth.user.sub` instead of indirecting through a
// DALIMember.id.

// ─── Bulk check (parallel queries) ───────────────────────────────────────────

export interface UserRoles {
  isLabMember: boolean;
  isHiringLead: boolean;
  isAdmin: boolean;
  isDomainLead: boolean;
}

/**
 * Resolve all role flags for a user with one round of parallel queries.
 * Use this in layout loaders instead of calling individual checks separately.
 */
export async function getUserRoles(userId: string): Promise<UserRoles> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);

  const [member, admin, core, domainLead] = await Promise.all([
    prisma.dALIMember.findUnique({ where: { userId }, select: { id: true } }),
    prisma.adminMembership.findUnique({ where: { userId }, select: { id: true } }),
    // Any CoreAssignment is sufficient for "hiring lead-equivalent" access.
    // Per V0_PLAN.md: Core members have broad access; we don't gate on
    // leadTitle. Term scoping is not required here — Core seats are
    // year-long and the few minutes around term rollover don't warrant a
    // current-term filter at this layer.
    prisma.coreAssignment.findFirst({ where: { userId }, select: { id: true } }),
    // DomainLeadAssignment.termId is required post-Phase-2; any row signals
    // domain-lead authority for that user.
    prisma.domainLeadAssignment.findFirst({ where: { userId }, select: { id: true } }),
  ]);

  const isAdminVal = admin !== null || envIds.includes(userId);
  const isCoreVal = core !== null;

  return {
    isLabMember: member !== null,
    // HiringLead semantics: Core members have hiring-lead-equivalent access
    // (V0_PLAN.md). Admins are a superset of Core. The legacy
    // DALIMember.roles[].HiringLead enum is gone.
    isHiringLead: isAdminVal || isCoreVal,
    isAdmin: isAdminVal,
    isDomainLead: domainLead !== null,
  };
}

// ─── Individual checks (for route-level guards) ──────────────────────────────

/** HiringLead-equivalent: Core or Admin. */
export async function isHiringLead(userId: string): Promise<boolean> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
  if (envIds.includes(userId)) return true;
  const [admin, core] = await Promise.all([
    prisma.adminMembership.findUnique({ where: { userId }, select: { id: true } }),
    prisma.coreAssignment.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return admin !== null || core !== null;
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

// ─── Cycle-scoped access ─────────────────────────────────────────────────────

/**
 * Check whether a user may read cycle-scoped hiring data.
 * Hiring leads and domain leads pass immediately. Other lab members pass
 * only if they are a CycleReviewer or CycleInterviewer for the given cycle.
 */
export async function hasCycleAccess(userId: string, cycleId: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (roles.isHiringLead || roles.isDomainLead) return true;
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

/**
 * Core for the current term, OR Admin. Same env-id override as isAdmin.
 * Use this when a feature should be open to Core access without going through
 * the legacy "isHiringLead" semantic.
 */
export async function isCore(userId: string): Promise<boolean> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
  if (envIds.includes(userId)) return true;
  const [admin, core] = await Promise.all([
    prisma.adminMembership.findUnique({ where: { userId }, select: { id: true } }),
    prisma.coreAssignment.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return admin !== null || core !== null;
}
