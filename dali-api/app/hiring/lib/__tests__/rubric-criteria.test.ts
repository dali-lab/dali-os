import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { buildCriteriaLabelMap, buildCriteriaList } from "../rubric-criteria";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  (mockPrisma as any).rubricVersion = { findMany: vi.fn() };
});

describe("buildCriteriaLabelMap", () => {
  it("returns only the general criteria when there is no domain/pinned version", async () => {
    const map = await buildCriteriaLabelMap({
      domainRubricVersionId: null,
      generalCriteria: [{ key: "g1", label: "Communication", maxScore: 5 }],
      pinnedVersionIds: [],
    });
    expect(map).toEqual({ g1: { label: "Communication", maxScore: 5, description: undefined } });
    expect(mockPrisma.rubricVersion.findMany).not.toHaveBeenCalled();
  });

  it("prefers the current domain rubric label over older history for the same key", async () => {
    mockPrisma.rubricVersion.findMany
      // directVersions (current + pinned)
      .mockResolvedValueOnce([
        {
          id: "rv-current",
          rubricId: "rub-1",
          versionNumber: 2,
          criteria: [{ key: "crit-a", label: "New Label", maxScore: 5 }],
        },
      ])
      // history scan
      .mockResolvedValueOnce([
        { criteria: [{ key: "crit-a", label: "New Label", maxScore: 5 }] },
        { criteria: [{ key: "crit-a", label: "Old Label", maxScore: 4 }] },
      ]);

    const map = await buildCriteriaLabelMap({
      domainRubricVersionId: "rv-current",
      pinnedVersionIds: [],
    });

    expect(map["crit-a"].label).toBe("New Label");
  });

  it("recovers an orphaned key from rubric history when the current version dropped it", async () => {
    mockPrisma.rubricVersion.findMany
      .mockResolvedValueOnce([
        {
          id: "rv-current",
          rubricId: "rub-1",
          versionNumber: 3,
          criteria: [{ key: "crit-kept", label: "Kept Criterion", maxScore: 5 }],
        },
      ])
      .mockResolvedValueOnce([
        { criteria: [{ key: "crit-kept", label: "Kept Criterion", maxScore: 5 }] },
        // An older version still carried the now-removed criterion.
        { criteria: [{ key: "crit-1778609863899", label: "Sound architecture", maxScore: 5 }] },
      ]);

    const map = await buildCriteriaLabelMap({
      domainRubricVersionId: "rv-current",
      pinnedVersionIds: [],
    });

    expect(map["crit-1778609863899"].label).toBe("Sound architecture");
    expect(map["crit-kept"].label).toBe("Kept Criterion");
  });

  it("fills in keys from a pinned version that the current version lacks", async () => {
    mockPrisma.rubricVersion.findMany
      .mockResolvedValueOnce([
        {
          id: "rv-current",
          rubricId: "rub-1",
          versionNumber: 2,
          criteria: [{ key: "crit-a", label: "Current A" }],
        },
        {
          id: "rv-pinned",
          rubricId: "rub-1",
          versionNumber: 1,
          criteria: [{ key: "crit-b", label: "Pinned B" }],
        },
      ])
      .mockResolvedValueOnce([]); // history empty for this assertion

    const map = await buildCriteriaLabelMap({
      domainRubricVersionId: "rv-current",
      pinnedVersionIds: ["rv-pinned"],
    });

    expect(map["crit-a"].label).toBe("Current A");
    expect(map["crit-b"].label).toBe("Pinned B");
  });

  it("buildCriteriaList returns the map as a flat array with keys", async () => {
    const list = await buildCriteriaList({
      domainRubricVersionId: null,
      generalCriteria: [{ key: "g1", label: "Communication", maxScore: 5 }],
      pinnedVersionIds: [],
    });
    expect(list).toEqual([
      { key: "g1", label: "Communication", maxScore: 5, description: undefined },
    ]);
  });
});
