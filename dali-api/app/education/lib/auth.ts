import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

export async function isInstructorOfOffering(
  userId: string,
  offeringId: string,
): Promise<boolean> {
  const row = await prisma.instructorAssignment.findFirst({
    where: { userId, offeringId },
    select: { id: true },
  });
  return row !== null;
}

export async function canManageOffering(
  userId: string,
  offeringId: string,
): Promise<boolean> {
  if (await isCore(userId)) return true;
  return isInstructorOfOffering(userId, offeringId);
}

export async function manageableOfferingIds(userId: string): Promise<string[] | "all"> {
  if (await isCore(userId)) return "all";
  const rows = await prisma.instructorAssignment.findMany({
    where: { userId },
    select: { offeringId: true },
  });
  return rows.map((r) => r.offeringId);
}
