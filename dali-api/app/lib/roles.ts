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
