import { prisma } from "~/lib/db";

// Hardcoded admin user IDs for now. Replace with a DB-backed role system later.
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS ?? "").split(",").filter(Boolean);

export async function requireMember(userId: string) {
  return prisma.dALIMember.findFirst({ where: { userId } });
}

export function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.includes(userId);
}
