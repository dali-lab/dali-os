import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  isApplicantBlinded,
  anonLabel,
  anonLabelMapForCycle,
  releasedDaIds,
  blindUser,
  reviewerBlindLabel,
  applicationBlindLabel,
  applicationBlindLabelsForCycle,
} from "~/hiring/lib/anonymization.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("isApplicantBlinded", () => {
  const on = { anonymizeReview: true };

  it("blinds a cycle with the toggle on and no released decision", () => {
    expect(isApplicantBlinded(on, false)).toBe(true);
  });

  it("does not blind once a decision is released", () => {
    expect(isApplicantBlinded(on, true)).toBe(false);
  });

  it("does not blind when the toggle is off", () => {
    expect(isApplicantBlinded({ anonymizeReview: false }, false)).toBe(false);
  });
});

describe("anonLabel", () => {
  it("formats a 1-indexed pseudonym", () => {
    expect(anonLabel(1)).toBe("Applicant 1");
    expect(anonLabel(7)).toBe("Applicant 7");
  });
});

describe("blindUser", () => {
  it("replaces the name and nulls selected identity fields, keeps opaque id", () => {
    const out = blindUser(
      {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        photoUrl: "s3://x",
        classYear: 2027,
        netId: "abc123",
        pronouns: "she/her",
      },
      "Applicant 3",
    );
    expect(out.firstName).toBe("Applicant 3");
    expect(out.lastName).toBe("");
    expect(out.photoUrl).toBeNull();
    expect(out.classYear).toBeNull();
    expect(out.netId).toBeNull();
    expect(out.pronouns).toBeNull();
    expect(out.id).toBe("u1");
  });

  it("does not add identity keys that weren't selected", () => {
    const out = blindUser({ firstName: "Ada", lastName: "Lovelace" }, "Applicant 2");
    expect(out).toEqual({ firstName: "Applicant 2", lastName: "" });
    expect("photoUrl" in out).toBe(false);
  });
});

describe("anonLabelMapForCycle", () => {
  it("assigns stable 1-indexed labels ordered by [createdAt, id]", async () => {
    mockPrisma.application.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const map = await anonLabelMapForCycle("cycle1");
    expect(map.get("a")).toBe("Applicant 1");
    expect(map.get("b")).toBe("Applicant 2");
    expect(map.get("c")).toBe("Applicant 3");
    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationCycleId: "cycle1" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });
});

describe("releasedDaIds", () => {
  it("returns the subset of DA ids with a released decision", async () => {
    mockPrisma.decision.findMany.mockResolvedValue([
      { domainApplicationId: "da1" },
      { domainApplicationId: "da3" },
    ]);
    const set = await releasedDaIds(["da1", "da2", "da3"]);
    expect(set.has("da1")).toBe(true);
    expect(set.has("da2")).toBe(false);
    expect(set.has("da3")).toBe(true);
  });

  it("short-circuits on empty input without querying", async () => {
    const set = await releasedDaIds([]);
    expect(set.size).toBe(0);
    expect(mockPrisma.decision.findMany).not.toHaveBeenCalled();
  });
});

describe("reviewerBlindLabel", () => {
  it("returns null without querying when anonymizeReview is off", async () => {
    const label = await reviewerBlindLabel({
      reviewerId: "rev-1",
      cycleId: "cycle-1",
      applicationId: "app-1",
      anonymizeReview: false,
    });
    expect(label).toBeNull();
    expect(mockPrisma.cycleReviewer.findMany).not.toHaveBeenCalled();
  });

  it("returns the same label on two calls for the same application", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ domainId: "domain-1" }]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([{ id: "da-1" }]);
    mockPrisma.decision.findMany.mockResolvedValue([]); // nothing released -> still blinded
    mockPrisma.application.findMany.mockResolvedValue([{ id: "app-1" }, { id: "app-2" }]);

    const args = {
      reviewerId: "rev-1",
      cycleId: "cycle-1",
      applicationId: "app-1",
      anonymizeReview: true,
    };
    const first = await reviewerBlindLabel(args);
    const second = await reviewerBlindLabel(args);

    expect(first).toBe("Applicant 1");
    expect(second).toBe("Applicant 1");
  });

  it("returns null once the reviewer's domain application has a released decision", async () => {
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ domainId: "domain-1" }]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([{ id: "da-1" }]);
    mockPrisma.decision.findMany.mockResolvedValue([{ domainApplicationId: "da-1" }]);

    const label = await reviewerBlindLabel({
      reviewerId: "rev-1",
      cycleId: "cycle-1",
      applicationId: "app-1",
      anonymizeReview: true,
    });

    expect(label).toBeNull();
  });
});

describe("applicationBlindLabel", () => {
  it("returns null without querying when anonymizeReview is off", async () => {
    const label = await applicationBlindLabel({
      cycleId: "cycle-1",
      applicationId: "app-1",
      anonymizeReview: false,
    });
    expect(label).toBeNull();
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("returns null once every selected domain application has a released decision", async () => {
    mockPrisma.domainApplication.findMany.mockResolvedValue([{ id: "da-1" }, { id: "da-2" }]);
    mockPrisma.decision.findMany.mockResolvedValue([
      { domainApplicationId: "da-1" },
      { domainApplicationId: "da-2" },
    ]);

    const label = await applicationBlindLabel({
      cycleId: "cycle-1",
      applicationId: "app-1",
      anonymizeReview: true,
    });

    expect(label).toBeNull();
  });

  it("stays blinded while even one selected domain application is unreleased", async () => {
    mockPrisma.domainApplication.findMany.mockResolvedValue([{ id: "da-1" }, { id: "da-2" }]);
    mockPrisma.decision.findMany.mockResolvedValue([{ domainApplicationId: "da-1" }]);
    mockPrisma.application.findMany.mockResolvedValue([{ id: "app-1" }]);

    const label = await applicationBlindLabel({
      cycleId: "cycle-1",
      applicationId: "app-1",
      anonymizeReview: true,
    });

    expect(label).toBe("Applicant 1");
  });

  it("blinds an application with no selected domain applications at all", async () => {
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.application.findMany.mockResolvedValue([{ id: "app-1" }]);

    const label = await applicationBlindLabel({
      cycleId: "cycle-1",
      applicationId: "app-1",
      anonymizeReview: true,
    });

    expect(label).toBe("Applicant 1");
  });
});

describe("applicationBlindLabelsForCycle", () => {
  it("returns an empty map without querying when anonymizeReview is off", async () => {
    const map = await applicationBlindLabelsForCycle({
      cycleId: "cycle-1",
      anonymizeReview: false,
      applications: [{ id: "app-1", daIds: ["da-1"] }],
    });
    expect(map.size).toBe(0);
    expect(mockPrisma.decision.findMany).not.toHaveBeenCalled();
  });

  it("includes only the applications with an unreleased domain, in one batched pair of queries", async () => {
    mockPrisma.decision.findMany.mockResolvedValue([{ domainApplicationId: "da-1" }]);
    mockPrisma.application.findMany.mockResolvedValue([{ id: "app-1" }, { id: "app-2" }]);

    const map = await applicationBlindLabelsForCycle({
      cycleId: "cycle-1",
      anonymizeReview: true,
      applications: [
        { id: "app-1", daIds: ["da-1"] }, // released -> not blinded
        { id: "app-2", daIds: ["da-2"] }, // unreleased -> blinded
      ],
    });

    expect(map.has("app-1")).toBe(false);
    expect(map.get("app-2")).toBe("Applicant 2");
    expect(mockPrisma.decision.findMany).toHaveBeenCalledTimes(1);
  });
});
