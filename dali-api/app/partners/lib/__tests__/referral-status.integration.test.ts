import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";

describe("OpportunityPost.partnerReferralId", () => {
  it("allows one post per referral and rejects a second", async () => {
    const user = await prisma.user.create({ data: { firstName: "Ada", lastName: "Lovelace" } });
    const referral = await prisma.partnerReferral.create({
      data: {
        referredByUserId: user.id,
        tier: "Cold",
        partnerName: "Pat",
        context: "Good fit",
      },
    });
    const data = {
      kind: "DaliUpdate" as const,
      authorId: null,
      body: "Acme is now a DALI project",
      partnerReferralId: referral.id,
    };
    await prisma.opportunityPost.create({ data });
    await expect(prisma.opportunityPost.create({ data })).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.opportunityPost.count({ where: { partnerReferralId: referral.id } })).toBe(1);
  });
});
