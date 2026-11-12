import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { formDeletionBlockers, formUsages, managingUsage } from "~/forms/lib/form-usages.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.resetAllMocks();
  for (const delegate of [
    "staffingCycleFormBinding",
    "applicationCycle",
    "cycleDomainForm",
    "educationOffering",
    "educationFormBinding",
    "banner",
  ]) {
    db[delegate].findMany.mockResolvedValue([]);
  }
  for (const delegate of [
    "onboardingProfileFormBinding",
    "partnerApplicationFormBinding",
    "partnerSurveyFormBinding",
  ]) {
    db[delegate].findFirst.mockResolvedValue(null);
  }
  for (const [delegate, fn] of [
    ["notification", "count"],
    ["partnerApplication", "count"],
    ["formSubmission", "count"],
    ["banner", "count"],
  ] as const) {
    db[delegate][fn].mockResolvedValue(0);
  }
});

describe("banner usage", () => {
  it("lists each banner pointing at the form without making the form managed", async () => {
    db.banner.findMany.mockResolvedValue([{ id: "bn1", name: "Intake nudge" }]);
    const usages = await formUsages("f1");
    expect(db.banner.findMany).toHaveBeenCalledWith({
      where: { untilFormId: "f1" },
      select: { id: true, name: true },
    });
    expect(usages).toEqual([
      {
        kind: "banner",
        label: "Banner: Intake nudge",
        href: "/core/communications/banners/bn1",
      },
    ]);
    expect(managingUsage(usages)).toBeNull();
  });
});

describe("deleting a form with banners", () => {
  it("is blocked by live banners, counted in the wording", async () => {
    db.banner.findMany.mockResolvedValue([{ id: "bn1", name: "A" }]);
    db.banner.count.mockResolvedValue(1);
    expect(await formDeletionBlockers("f1")).toEqual(["1 live banner points at it"]);
    db.banner.count.mockResolvedValue(3);
    expect(await formDeletionBlockers("f1")).toEqual(["3 live banners point at it"]);
  });

  it("counts only published banners that have not ended", async () => {
    await formDeletionBlockers("f1");
    const where = db.banner.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ untilFormId: "f1", published: true, endsAt: { gt: expect.any(Date) } });
  });

  it("is not blocked by ended or unpublished banners", async () => {
    db.banner.findMany.mockResolvedValue([{ id: "bn1", name: "A" }]);
    db.banner.count.mockResolvedValue(0);
    expect(await formDeletionBlockers("f1")).toEqual([]);
  });
});
