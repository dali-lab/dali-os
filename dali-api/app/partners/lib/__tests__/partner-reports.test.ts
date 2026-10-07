import { describe, it, expect } from "vitest";
import {
  median,
  computeFunnel,
  computeFunnelBySource,
  computeCycleTimes,
  computeRejectionReasons,
  isReturningOrg,
  computePartnerMix,
  computeCapacity,
  computeRevenueByOrg,
} from "../partner-reports";

describe("median", () => {
  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });

  it("averages the two middle values for an even count", () => {
    expect(median([1, 3])).toBe(2);
  });

  it("returns the middle value for an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe("computeFunnel", () => {
  it("counts applications per current stage", () => {
    const apps = [
      { id: "a1", stage: "New" as const },
      { id: "a2", stage: "Interview" as const },
      { id: "a3", stage: "Accepted" as const },
      { id: "a4", stage: "Rejected" as const },
    ];
    const result = computeFunnel(apps, []);
    expect(result.stageCounts).toEqual({ New: 1, Interview: 1, Accepted: 1, Rejected: 1 });
    expect(result.total).toBe(4);
  });

  it("credits a Rejected card that passed through Interview first toward newToInterviewRate", () => {
    const apps = [
      { id: "a1", stage: "Rejected" as const },
      { id: "a2", stage: "New" as const },
    ];
    const statusChanges = [
      { applicationId: "a1", to: "Interview" as const },
      { applicationId: "a1", to: "Rejected" as const },
    ];
    const result = computeFunnel(apps, statusChanges);
    // 1 of 2 apps ever reached Interview.
    expect(result.newToInterviewRate).toBe(0.5);
    // Neither reached Accepted.
    expect(result.interviewToAcceptedRate).toBe(0);
  });

  it("returns null rates when there are no applications", () => {
    const result = computeFunnel([], []);
    expect(result.newToInterviewRate).toBeNull();
    expect(result.interviewToAcceptedRate).toBeNull();
  });
});

describe("computeFunnelBySource", () => {
  it("counts and sorts descending", () => {
    const rows = computeFunnelBySource([
      { source: "Form" as const },
      { source: "Email" as const },
      { source: "Form" as const },
    ]);
    expect(rows).toEqual([
      { source: "Form", count: 2 },
      { source: "Email", count: 1 },
    ]);
  });
});

describe("computeCycleTimes", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const base = new Date("2026-01-01T00:00:00Z").getTime();

  it("computes median days Created -> Accepted and Created -> project", () => {
    const activities = [
      { applicationId: "a1", type: "Created" as const, createdAt: new Date(base), metadata: null },
      {
        applicationId: "a1",
        type: "StatusChanged" as const,
        createdAt: new Date(base + 5 * DAY),
        metadata: { from: "Interview", to: "Accepted", projectId: "proj1" },
      },
      { applicationId: "a2", type: "Created" as const, createdAt: new Date(base), metadata: null },
      {
        applicationId: "a2",
        type: "StatusChanged" as const,
        createdAt: new Date(base + 9 * DAY),
        metadata: { from: "Interview", to: "Accepted" },
      },
    ];
    const result = computeCycleTimes(activities);
    expect(result.medianToAcceptedDays).toBe(7); // median of [5, 9]
    expect(result.medianToProjectDays).toBe(5); // only a1 carries projectId
    expect(result.sampleSize).toEqual({ toAccepted: 2, toProject: 1 });
  });

  it("skips an application with no Created row", () => {
    const activities = [
      {
        applicationId: "a1",
        type: "StatusChanged" as const,
        createdAt: new Date(base),
        metadata: { to: "Accepted" },
      },
    ];
    const result = computeCycleTimes(activities);
    expect(result.medianToAcceptedDays).toBeNull();
    expect(result.sampleSize).toEqual({ toAccepted: 0, toProject: 0 });
  });

  it("ignores org/contact-level activities with no applicationId", () => {
    const activities = [
      { applicationId: null, type: "Created" as const, createdAt: new Date(base), metadata: null },
    ];
    expect(computeCycleTimes(activities).sampleSize).toEqual({ toAccepted: 0, toProject: 0 });
  });
});

describe("computeRejectionReasons", () => {
  it("counts non-null reasons and sorts descending", () => {
    const rows = computeRejectionReasons([
      { rejectReason: "NotAFit" as const },
      { rejectReason: null },
      { rejectReason: "NotAFit" as const },
      { rejectReason: "Timing" as const },
    ]);
    expect(rows).toEqual([
      { reason: "NotAFit", count: 2 },
      { reason: "Timing", count: 1 },
    ]);
  });
});

describe("isReturningOrg", () => {
  const termStart = new Date("2026-09-01T00:00:00Z");

  it("is false with fewer than two links", () => {
    expect(isReturningOrg([{ startedAt: new Date("2026-01-01") }], termStart)).toBe(false);
    expect(isReturningOrg([], termStart)).toBe(false);
  });

  it("is true when the earliest link predates the term", () => {
    expect(
      isReturningOrg(
        [{ startedAt: new Date("2025-01-01") }, { startedAt: new Date("2026-09-15") }],
        termStart,
      ),
    ).toBe(true);
  });

  it("is false when both links start within/after the term", () => {
    expect(
      isReturningOrg(
        [{ startedAt: new Date("2026-09-10") }, { startedAt: new Date("2026-09-15") }],
        termStart,
      ),
    ).toBe(false);
  });

  it("treats two-or-more links as returning with no term boundary (all time)", () => {
    expect(
      isReturningOrg([{ startedAt: new Date("2026-09-10") }, { startedAt: new Date("2026-09-15") }]),
    ).toBe(true);
  });
});

describe("computePartnerMix", () => {
  it("splits orgs into new and returning", () => {
    const termStart = new Date("2026-09-01T00:00:00Z");
    const result = computePartnerMix(
      [
        { orgId: "o1", orgName: "Acme", links: [{ startedAt: new Date("2025-01-01") }, { startedAt: new Date("2026-09-10") }] },
        { orgId: "o2", orgName: "Beta", links: [{ startedAt: new Date("2026-09-05") }] },
      ],
      termStart,
    );
    expect(result.newCount).toBe(1);
    expect(result.returningCount).toBe(1);
    expect(result.newOrgs).toEqual([{ orgId: "o2", orgName: "Beta" }]);
    expect(result.returningOrgs).toEqual([{ orgId: "o1", orgName: "Acme" }]);
  });
});

describe("computeCapacity", () => {
  it("sums expected members and counts staffed assignments per domain", () => {
    const cells = computeCapacity(
      [
        { domainId: "d1", domainName: "Engineering", expectedMembers: 3 },
        { domainId: "d1", domainName: "Engineering", expectedMembers: 2 },
        { domainId: "d2", domainName: "Design", expectedMembers: 1 },
      ],
      [
        { domainId: "d1", domainName: "Engineering" },
        { domainId: "d1", domainName: "Engineering" },
      ],
    );
    expect(cells).toEqual([
      { domainId: "d2", domainName: "Design", expected: 1, staffed: 0 },
      { domainId: "d1", domainName: "Engineering", expected: 5, staffed: 2 },
    ]);
  });
});

describe("computeRevenueByOrg", () => {
  it("sums only Paid/Issued invoices per org, sorted descending", () => {
    const rows = computeRevenueByOrg([
      { orgId: "o1", orgName: "Acme", amountCents: 10_000, status: "Paid" as const },
      { orgId: "o1", orgName: "Acme", amountCents: 5_000, status: "Issued" as const },
      { orgId: "o1", orgName: "Acme", amountCents: 999_999, status: "Draft" as const },
      { orgId: "o2", orgName: "Beta", amountCents: 1_000, status: "Paid" as const },
    ]);
    expect(rows).toEqual([
      { orgId: "o1", orgName: "Acme", totalCents: 15_000 },
      { orgId: "o2", orgName: "Beta", totalCents: 1_000 },
    ]);
  });
});
