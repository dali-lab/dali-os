import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";

/**
 * Offering-scoped manager check: Core (which already covers Admin) or an
 * InstructorAssignment for this offering (any term). PMs, mentors etc. get
 * nothing special — education management is instructor/Core only.
 */
export async function isOfferingManager(
  userId: string,
  offeringId: string,
): Promise<boolean> {
  if (await isCore(userId)) return true;
  const row = await prisma.instructorAssignment.findFirst({
    where: { userId, offeringId },
    select: { id: true },
  });
  return row !== null;
}
