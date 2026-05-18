import { prisma } from "~/lib/db";

// Single source of truth for resolving a GroupDefinition to its member userIds.
// Notification fan-out and meeting participant resolution both go through this.
export async function resolveGroupMembers(groupId: string): Promise<string[]> {
  const group = await prisma.groupDefinition.findUnique({
    where: { id: groupId },
    select: { staticMemberIds: true },
  });
  if (!group) return [];
  return group.staticMemberIds;
}

// Every current lab member's userId. "Lab member" = a User with a DALIMember
// marker row (the same definition the admin members page uses). Used by the
// "whole lab" announcement audience.
export async function resolveAllLabMembers(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { daliMember: { isNot: null } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
