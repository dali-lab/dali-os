import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  isApplicantBlinded,
  anonLabel,
  anonLabelMapForCycle,
  releasedDaIds,
  blindUser,
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
  const on = { cycleType: "Standard", anonymizeReview: true };

  it("blinds a Standard cycle with the toggle on and no released decision", () => {
    expect(isApplicantBlinded(on, false)).toBe(true);
  });

  it("does not blind once a decision is released (moved into interviews)", () => {
    expect(isApplicantBlinded(on, true)).toBe(false);
  });

  it("does not blind when the toggle is off", () => {
    expect(isApplicantBlinded({ cycleType: "Standard", anonymizeReview: false }, false)).toBe(
      false,
    );
  });

  it("does not blind internal (Fellowship/Core) cycles", () => {
    expect(isApplicantBlinded({ cycleType: "Fellowship", anonymizeReview: true }, false)).toBe(
      false,
    );
    expect(isApplicantBlinded({ cycleType: "Core", anonymizeReview: true }, false)).toBe(false);
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
