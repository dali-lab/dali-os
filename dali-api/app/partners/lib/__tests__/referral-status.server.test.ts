import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn().mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 }),
}));

import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import {
  linkReferralToApplication,
  loadMyReferrals,
  onApplicationBecameProject,
} from "../referral-status.server";

const db = prisma as unknown as Record<string, any>;

const referral = {
  id: "r1",
  referredByUserId: "u1",
  partnerName: "Pat",
  partnerOrgName: "Acme Health",
  referredBy: { firstName: "Ada", lastName: "Lovelace" },
};

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint"), { code: "P2002" });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerReferral = {
    findMany: vi.fn().mockResolvedValue([referral]),
    update: vi.fn().mockResolvedValue({}),
  };
  db.partnerApplication = {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  };
  db.project = { findUnique: vi.fn().mockResolvedValue({ name: "Care Tracker" }) };
  db.opportunityPost = { create: vi.fn().mockResolvedValue({}) };
});

describe("loadMyReferrals", () => {
  it("derives a status per referral, newest first", async () => {
    db.partnerReferral.findMany.mockResolvedValue([
      { id: "a", partnerName: "A", partnerOrgName: null, tier: "Cold", reachedOutAt: null, partnerApplicationId: "app1", createdAt: new Date("2026-02-01") },
      { id: "b", partnerName: "B", partnerOrgName: "B Co", tier: "Warm", reachedOutAt: new Date(), partnerApplicationId: null, createdAt: new Date("2026-01-01") },
    ]);
    db.partnerApplication.findMany.mockResolvedValue([{ id: "app1", resultingProjectId: "p1" }]);
    const out = await loadMyReferrals("u1");
    expect(db.partnerReferral.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referredByUserId: "u1" }, orderBy: { createdAt: "desc" } }),
    );
    expect(out.map((r) => [r.id, r.status, r.projectId])).toEqual([
      ["a", "Project", "p1"],
      ["b", "DaliCalled", null],
    ]);
  });

  it("skips the application lookup when nothing is linked", async () => {
    db.partnerReferral.findMany.mockResolvedValue([]);
    expect(await loadMyReferrals("u1")).toEqual([]);
    expect(db.partnerApplication.findMany).not.toHaveBeenCalled();
  });
});

describe("linkReferralToApplication", () => {
  it("links to an application that is not a project yet without posting", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ id: "app1", resultingProjectId: null });
    expect(await linkReferralToApplication("r1", "app1", "core1")).toEqual({ ok: true });
    expect(db.partnerReferral.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { partnerApplicationId: "app1" },
    });
    expect(db.opportunityPost.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("clears the link", async () => {
    await linkReferralToApplication("r1", null, "core1");
    expect(db.partnerReferral.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { partnerApplicationId: null },
    });
    expect(db.partnerApplication.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an unknown application and writes nothing", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    expect(await linkReferralToApplication("r1", "nope", "core1")).toEqual({
      ok: false,
      error: "Application not found",
    });
    expect(db.partnerReferral.update).not.toHaveBeenCalled();
  });

  it("posts and notifies when the application is already a project", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ id: "app1", resultingProjectId: "p1" });
    await linkReferralToApplication("r1", "app1", "core1");
    expect(db.partnerReferral.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerApplicationId: "app1", id: "r1" } }),
    );
    expect(db.opportunityPost.create).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("still links when posting fails", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ id: "app1", resultingProjectId: "p1" });
    db.opportunityPost.create.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await linkReferralToApplication("r1", "app1", "core1")).toEqual({ ok: true });
  });
});

describe("onApplicationBecameProject", () => {
  it("creates one DALI post per linked referral and notifies the referrer", async () => {
    db.partnerReferral.findMany.mockResolvedValue([
      referral,
      { ...referral, id: "r2", referredByUserId: "u2", partnerOrgName: null, referredBy: { firstName: "Grace", lastName: "Hopper" } },
    ]);
    await onApplicationBecameProject("app1", "p1");
    expect(db.opportunityPost.create).toHaveBeenCalledTimes(2);
    expect(db.opportunityPost.create).toHaveBeenNthCalledWith(1, {
      data: {
        kind: "DaliUpdate",
        authorId: null,
        body: "Acme Health is now a DALI project: Care Tracker. It started with a referral from Ada Lovelace.",
        partnerReferralId: "r1",
      },
    });
    expect(db.opportunityPost.create.mock.calls[1][0].data.body).toContain("Pat is now a DALI project");
    expect(notify).toHaveBeenCalledWith({
      eventType: "opportunities.referral_shipped",
      message: {
        vars: { itemDetail: expect.stringContaining("Care Tracker") },
        link: "/community/opportunities",
        dedupKey: "opportunities.referral_shipped:r1",
      },
      recipients: [{ userId: "u1" }],
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("is idempotent: a repeat hits the unique constraint, posts nothing and notifies nobody", async () => {
    db.opportunityPost.create.mockRejectedValue(uniqueViolation());
    await onApplicationBecameProject("app1", "p1");
    expect(notify).not.toHaveBeenCalled();
  });

  it("does nothing when no referral is linked", async () => {
    db.partnerReferral.findMany.mockResolvedValue([]);
    await onApplicationBecameProject("app1", "p1");
    expect(db.opportunityPost.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("never throws, so promotion survives a failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.partnerReferral.findMany.mockRejectedValue(new Error("db down"));
    await expect(onApplicationBecameProject("app1", "p1")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it("never throws when notify fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (notify as any).mockRejectedValueOnce(new Error("smtp"));
    await expect(onApplicationBecameProject("app1", "p1")).resolves.toBeUndefined();
  });
});
