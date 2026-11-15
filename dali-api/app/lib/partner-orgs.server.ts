import { prisma } from "~/lib/db.server";

// Current org ids the signed-in partner account belongs to (memberships that
// haven't ended). Empty for a fresh applicant / logged inquiry with no org yet.
export async function partnerOrgIdsForUser(userSub: string): Promise<string[]> {
  const contact = await prisma.partnerContact.findUnique({
    where: { userId: userSub },
    select: { memberships: { where: { endedAt: null }, select: { orgId: true } } },
  });
  return contact?.memberships.map((m) => m.orgId) ?? [];
}
