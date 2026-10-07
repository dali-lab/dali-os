import { describe, it, expect } from "vitest";
import { partnerRelationshipStatus, planOrgMerge } from "../partner-org";

describe("partnerRelationshipStatus", () => {
  const now = new Date("2026-10-06T00:00:00Z");

  it("is Prospect when there are no project links", () => {
    expect(
      partnerRelationshipStatus({ projectLinks: [], lastActivityAt: null, now }),
    ).toBe("Prospect");
  });

  it("is Active when any link has no endedAt", () => {
    expect(
      partnerRelationshipStatus({
        projectLinks: [{ endedAt: new Date("2020-01-01") }, { endedAt: null }],
        lastActivityAt: null,
        now,
      }),
    ).toBe("Active");
  });

  it("is Past when every link ended and activity is recent", () => {
    expect(
      partnerRelationshipStatus({
        projectLinks: [{ endedAt: new Date("2026-09-01") }],
        lastActivityAt: new Date("2026-09-15"),
        now,
      }),
    ).toBe("Past");
  });

  it("is Dormant when every link ended and activity is older than a year", () => {
    expect(
      partnerRelationshipStatus({
        projectLinks: [{ endedAt: new Date("2024-01-01") }],
        lastActivityAt: new Date("2025-01-01"),
        now,
      }),
    ).toBe("Dormant");
  });

  it("is Dormant when every link ended and there's no activity at all", () => {
    expect(
      partnerRelationshipStatus({
        projectLinks: [{ endedAt: new Date("2024-01-01") }],
        lastActivityAt: null,
        now,
      }),
    ).toBe("Dormant");
  });
});

describe("planOrgMerge", () => {
  it("repoints memberships whose contact isn't already at the survivor", () => {
    const plan = planOrgMerge({
      sourceMemberships: [
        { id: "m1", contactId: "c1" },
        { id: "m2", contactId: "c2" },
      ],
      survivorContactIds: ["c2"],
      sourceProjectLinks: [],
      survivorProjectIds: [],
    });
    expect(plan.membershipIdsToRepoint).toEqual(["m1"]);
  });

  it("repoints project links whose project isn't already linked at the survivor, and queues duplicates for removal", () => {
    const plan = planOrgMerge({
      sourceMemberships: [],
      survivorContactIds: [],
      sourceProjectLinks: [
        { id: "pp1", projectId: "proj-1" },
        { id: "pp2", projectId: "proj-2" },
      ],
      survivorProjectIds: ["proj-2"],
    });
    expect(plan.projectLinkIdsToRepoint).toEqual(["pp1"]);
    expect(plan.projectLinkIdsToRemove).toEqual(["pp2"]);
  });

  it("returns empty plans when there's nothing to merge", () => {
    const plan = planOrgMerge({
      sourceMemberships: [],
      survivorContactIds: [],
      sourceProjectLinks: [],
      survivorProjectIds: [],
    });
    expect(plan).toEqual({
      membershipIdsToRepoint: [],
      projectLinkIdsToRepoint: [],
      projectLinkIdsToRemove: [],
    });
  });
});
