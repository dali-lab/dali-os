import { prisma } from "~/lib/db.server";
import { listVisibleGroupIdsForUser } from "~/lib/groups.server";
import { getUserRoles } from "~/lib/roles";
import type { ExpenseViewer } from "./access";

export async function loadExpenseViewer(userId: string, request?: Request): Promise<ExpenseViewer> {
  const [roles, cards, groups] = await Promise.all([
    getUserRoles(userId, request),
    prisma.expenseCard.findMany({ where: { ownerId: userId }, select: { id: true } }),
    listVisibleGroupIdsForUser(userId, request),
  ]);
  return {
    userId,
    isCore: roles.isCore,
    isStaff: roles.isStaff,
    ownedCardIds: cards.map((c) => c.id),
    groupIds: groups.map((g) => g.id),
  };
}
