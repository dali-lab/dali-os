import { prisma } from "~/lib/db";
import { addOrUpdateEligibility } from "~/admin/lib/eligibility.server";
import type { Level } from "~/admin/lib/eligibility";

// Promote an existing User to a lab member (DALIMember marker row), optionally
// granting domain eligibility. Used by:
//   - the /members directory action (manual add/promote)
//   - the accepted-applicant release flow (auto-promote on Accepted)
//
// Idempotent: re-promoting an existing member is a no-op for membership, and
// the eligibility grant goes through addOrUpdateEligibility's upsert. A
// brand-new member's DALIMember starts with a null onboardedAt so the layout
// gate sends them through /onboarding; an already-onboarded member keeps theirs.
export async function promoteToMember(args: {
  userId: string;
  // When set, grant DomainEligibility at this level in this domain.
  domainId?: string;
  level?: Level;
  // Who triggered the promotion (stamped on the eligibility grant).
  actorId: string;
}): Promise<{ created: boolean }> {
  const existing = await prisma.dALIMember.findUnique({
    where: { userId: args.userId },
    select: { id: true },
  });
  if (!existing) {
    await prisma.dALIMember.create({ data: { userId: args.userId } });
  }

  if (args.domainId && args.level) {
    await addOrUpdateEligibility({
      userId: args.userId,
      domainId: args.domainId,
      level: args.level,
      actorId: args.actorId,
    });
  }

  return { created: !existing };
}
