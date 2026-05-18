import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

export const EDUCATION_LEAD_TITLE = "Education Lead";

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
  isCore: boolean;
  isEducationLead: boolean;
  isInstructor: boolean;
}

/**
 * Resolve all role flags for a user with one round of parallel queries.
 * Use this in layout loaders instead of calling individual checks separately.
 */
export async function getUserRoles(userId: string): Promise<UserRoles> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);

  const [member, admin, core, educationLead, instructor, domainLead] = await Promise.all([
    prisma.dALIMember.findUnique({ where: { userId }, select: { id: true } }),
    prisma.adminMembership.findUnique({ where: { userId }, select: { id: true } }),
    // Any CoreAssignment is sufficient for "hiring lead-equivalent" access.
    // Per V0_PLAN.md: Core members have broad access; we don't gate on
    // leadTitle. Term scoping is not required here — Core seats are
    // year-long and the few minutes around term rollover don't warrant a
    // current-term filter at this layer.
    prisma.coreAssignment.findFirst({ where: { userId }, select: { id: true } }),
    prisma.coreAssignment.findFirst({
      where: { userId, leadTitle: EDUCATION_LEAD_TITLE },
      select: { id: true },
    }),
    prisma.instructorAssignment.findFirst({ where: { userId }, select: { id: true } }),
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
    isCore: isAdminVal || isCoreVal,
    isEducationLead: educationLead !== null,
    isInstructor: instructor !== null,
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

// ─── Education-scoped helpers ────────────────────────────────────────────────

/** Core for the current term. Admins are a superset of Core. */
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

/** True when the user holds a Core seat with leadTitle = "Education Lead". */
export async function isEducationLead(userId: string): Promise<boolean> {
  const row = await prisma.coreAssignment.findFirst({
    where: { userId, leadTitle: EDUCATION_LEAD_TITLE },
    select: { id: true },
  });
  return row !== null;
}

/** True when the user is currently an instructor for the offering (any term). */
export async function isInstructorFor(
  userId: string,
  offeringId: string,
): Promise<boolean> {
  const row = await prisma.instructorAssignment.findFirst({
    where: { userId, offeringId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Gate helper for Education manager loaders/actions. Returns either an
 * authenticated userId or a Response the caller should throw. Pass
 * `offeringId = null` for endpoints that only Core may use (e.g. create
 * an offering).
 */
export async function requireInstructorOrCore(
  request: Request,
  offeringId: string | null,
): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: Response }
> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  if (await isCore(auth.user.sub)) return { ok: true, userId: auth.user.sub };

  if (offeringId && (await isInstructorFor(auth.user.sub, offeringId))) {
    return { ok: true, userId: auth.user.sub };
  }

  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
  };
}
