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
