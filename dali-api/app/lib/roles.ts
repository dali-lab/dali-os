import { prisma } from "~/lib/db";
import type { MemberRole } from "~/generated/prisma/enums";

// ─── Core lookup ─────────────────────────────────────────────────────────────

/** Fetch the DALIMember record (with roles + domain lead assignments) for a user. */
async function getMember(userId: string) {
  return prisma.dALIMember.findFirst({
    where: { userId },
    select: {
      id: true,
      roles: true,
      domainLeadAssignments: { select: { id: true }, take: 1 },
    },
  });
}

// ─── Bulk check (one query) ───────────────────────────────────────────────────

export interface UserRoles {
  memberId: string | null;
  isHiringLead: boolean;
  isAdmin: boolean;
  isDomainLead: boolean;
}

/**
 * Resolve all role flags for a user in a single DB query.
 * Use this in layout loaders instead of calling individual checks in parallel.
 */
export async function getUserRoles(userId: string): Promise<UserRoles> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "").split(",").filter(Boolean);
  const member = await getMember(userId);

  return {
    memberId: member?.id ?? null,
    isHiringLead: envIds.includes(userId) || (member?.roles.includes("HiringLead") ?? false),
    isAdmin: member?.roles.includes("Admin") ?? false,
    isDomainLead: (member?.domainLeadAssignments.length ?? 0) > 0,
  };
}

// ─── Individual checks (for route-level guards) ───────────────────────────────

/** HiringLead: manages cycles, forms, challenges, rubrics. */
export async function isHiringLead(userId: string): Promise<boolean> {
  const envIds = (process.env.ADMIN_USER_IDS ?? "").split(",").filter(Boolean);
  if (envIds.includes(userId)) return true;
  const member = await getMember(userId);
  return member?.roles.includes("HiringLead") ?? false;
}

/** Admin: view member list, assign hiring leads and domain leads. */
export async function isAdmin(userId: string): Promise<boolean> {
  const member = await getMember(userId);
  return member?.roles.includes("Admin") ?? false;
}

/** DomainLead: has at least one DomainLeadAssignment. */
export async function isDomainLead(userId: string): Promise<boolean> {
  const member = await getMember(userId);
  return (member?.domainLeadAssignments.length ?? 0) > 0;
}

export async function requireMember(userId: string) {
  return prisma.dALIMember.findFirst({ where: { userId } });
}

// ─── Detailed role labels (for display) ──────────────────────────────────────

/**
 * Returns human-readable role labels for display on the account page.
 * E.g. ["Admin", "Domain Lead — Design", "Cycle Reviewer — Fall 2026, Engineering"]
 */
export async function getUserRolesDetailed(userId: string): Promise<string[]> {
  const member = await prisma.dALIMember.findFirst({
    where: { userId },
    select: {
      roles: true,
      domainLeadAssignments: {
        select: { domain: { select: { name: true } } },
      },
      cycleReviewers: {
        select: {
          applicationCycle: { select: { name: true } },
          domain: { select: { name: true } },
        },
      },
      cycleInterviewers: {
        select: {
          applicationCycle: { select: { name: true } },
          domain: { select: { name: true } },
        },
      },
    },
  });

  if (!member) return [];

  const envIds = (process.env.ADMIN_USER_IDS ?? "").split(",").filter(Boolean);
  const labels: string[] = [];

  if (member.roles.includes("Admin")) labels.push("Admin");
  if (member.roles.includes("HiringLead") || envIds.includes(userId)) labels.push("Hiring Lead");

  for (const a of member.domainLeadAssignments) {
    labels.push(`Domain Lead — ${a.domain.name}`);
  }
  for (const r of member.cycleReviewers) {
    labels.push(`Cycle Reviewer — ${r.applicationCycle.name}, ${r.domain.name}`);
  }
  for (const i of member.cycleInterviewers) {
    labels.push(`Cycle Interviewer — ${i.applicationCycle.name}, ${i.domain.name}`);
  }

  return labels;
}

// ─── Cycle-scoped access ────────────────────────────────────────────────────

/**
 * Check whether a user may read cycle-scoped hiring data.
 * Hiring leads and domain leads pass immediately (1 DB query).
 * Other DALI members pass only if they are a CycleReviewer or
 * CycleInterviewer for the given cycle.
 */
export async function hasCycleAccess(userId: string, cycleId: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (roles.isHiringLead || roles.isDomainLead) return true;
  if (!roles.memberId) return false;

  const [reviewer, interviewer] = await Promise.all([
    prisma.cycleReviewer.findFirst({
      where: { daliMemberId: roles.memberId, applicationCycleId: cycleId },
      select: { id: true },
    }),
    prisma.cycleInterviewer.findFirst({
      where: { daliMemberId: roles.memberId, applicationCycleId: cycleId },
      select: { id: true },
    }),
  ]);
  return reviewer !== null || interviewer !== null;
}
