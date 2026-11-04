import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/partners/lib/partner-notify.server", () => ({
  notifyPartners: vi.fn().mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 }),
}));

import { prisma } from "~/lib/db.server";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import {
  createPartnerReferral,
  hasPassedReferralQuiz,
  recordReferralQuizPass,
  setReferralReachedOut,
} from "../referrals.server";

const db = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerReferralQuizPass = {
    findUnique: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
  };
  db.partnerReferral = {
    create: vi.fn().mockResolvedValue({ id: "r1" }),
    update: vi.fn().mockResolvedValue({}),
  };
  db.user = {
    findUnique: vi.fn().mockResolvedValue({ firstName: "Pat", lastName: "Doe" }),
  };
});

describe("hasPassedReferralQuiz", () => {
  it("returns true when a pass row exists", async () => {
    db.partnerReferralQuizPass.findUnique.mockResolvedValue({ id: "pass-1" });
    expect(await hasPassedReferralQuiz("u1")).toBe(true);
  });

  it("returns false when the member has never passed", async () => {
    db.partnerReferralQuizPass.findUnique.mockResolvedValue(null);
    expect(await hasPassedReferralQuiz("u1")).toBe(false);
  });
});

describe("recordReferralQuizPass", () => {
  it("upserts one row per user", async () => {
    await recordReferralQuizPass({ userId: "u1", attempts: 2 });
    expect(db.partnerReferralQuizPass.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        create: expect.objectContaining({ userId: "u1", attempts: 2 }),
      }),
    );
  });

  it("floors attempts to at least 1 so a crafted payload can't store 0", async () => {
    await recordReferralQuizPass({ userId: "u1", attempts: 0 });
    expect(db.partnerReferralQuizPass.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ attempts: 1 }),
      }),
    );
  });
});

describe("createPartnerReferral", () => {
  const baseInput = {
    referredByUserId: "u1",
    tier: "Warm" as const,
    partnerName: " Jane Smith ",
    partnerEmail: " Jane@Example.com ",
    context: "  We work together on a nonprofit  ",
  };

  it("trims strings, persists the row, and notifies Core", async () => {
    const result = await createPartnerReferral(baseInput);

    expect(result).toEqual({ id: "r1" });
    expect(db.partnerReferral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referredByUserId: "u1",
          tier: "Warm",
          partnerName: "Jane Smith",
          partnerEmail: "Jane@Example.com",
          context: "We work together on a nonprofit",
          pitchBody: null,
        }),
      }),
    );
    expect(notifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.referral_received",
        title: "Warm referral: Jane Smith",
        body: "From Pat Doe",
        link: "/core/partners/referrals/r1",
        createdByUserId: "u1",
      }),
    );
  });

  it("coerces pitchBody to null on non-FullPitch tiers so a stray payload does not leak into the record", async () => {
    await createPartnerReferral({ ...baseInput, pitchBody: "ignored" });
    expect(db.partnerReferral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pitchBody: null }),
      }),
    );
  });

  it("persists the pitch body for FullPitch referrals", async () => {
    await createPartnerReferral({
      ...baseInput,
      tier: "FullPitch",
      pitchBody: "Build them a donation portal",
    });
    expect(db.partnerReferral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tier: "FullPitch",
          pitchBody: "Build them a donation portal",
        }),
      }),
    );
  });

  it("falls back to 'A member' in the notification body when the referrer row can't be read", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await createPartnerReferral(baseInput);
    expect(notifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({ body: "From A member" }),
    );
  });
});

describe("setReferralReachedOut", () => {
  it("stamps the actor and current time when marking reached-out", async () => {
    await setReferralReachedOut({ id: "r1", reached: true, actorUserId: "u1" });
    expect(db.partnerReferral.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({
        reachedOutByUserId: "u1",
        reachedOutAt: expect.any(Date),
      }),
    });
  });

  it("clears both fields when undoing a misclick", async () => {
    await setReferralReachedOut({ id: "r1", reached: false, actorUserId: "u1" });
    expect(db.partnerReferral.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { reachedOutAt: null, reachedOutByUserId: null },
    });
  });
});
