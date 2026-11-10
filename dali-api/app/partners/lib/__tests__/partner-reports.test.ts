import { describe, it, expect } from "vitest";
import {
  median,
  computeFunnel,
  computeFunnelBySource,
  computeCycleTimes,
  computeRejectionReasons,
  isReturningOrg,
  computePartnerMix,
  computeFunnelReached,
  computeFunnelSteps,
  formatFunnelValue,
  barPercent,
  formatMedianDays,
  topWithRemainder,
  reportSourceHref,
  splitPercent,
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
      { id: "a0", stage: "Backlog" as const },
      { id: "a1", stage: "New" as const },
      { id: "a2", stage: "Interview" as const },
      { id: "a3", stage: "Accepted" as const },
      { id: "a4", stage: "Rejected" as const },
    ];
    const result = computeFunnel(apps, []);
    expect(result.stageCounts).toEqual({ Backlog: 1, New: 1, Interview: 1, Deciding: 0, Accepted: 1, Rejected: 1 });
    expect(result.total).toBe(5);
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
      { id: "a1", rejectReason: "NotAFit" as const },
      { id: "a2", rejectReason: null },
      { id: "a3", rejectReason: "NotAFit" as const },
      { id: "a4", rejectReason: "Timing" as const },
    ]);
    expect(rows).toEqual([
      { reason: "NotAFit", count: 2, ids: ["a1", "a3"] },
      { reason: "Timing", count: 1, ids: ["a4"] },
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

describe("Deciding in the funnel", () => {
  it("counts a Deciding application in stageCounts and as having reached interview", () => {
    const apps = [
      { id: "a1", stage: "Deciding" as const },
      { id: "a2", stage: "New" as const },
    ];
    const result = computeFunnel(apps, []);
    expect(result.stageCounts.Deciding).toBe(1);
    expect(result.newToInterviewRate).toBe(0.5);
    expect(computeFunnelReached(apps, []).interview).toEqual(["a1"]);
  });

  it("credits a Rejected card that passed through Deciding", () => {
    const apps = [{ id: "a1", stage: "Rejected" as const }];
    const reached = computeFunnelReached(apps, [{ applicationId: "a1", to: "Deciding" }]);
    expect(reached.interview).toEqual(["a1"]);
    expect(reached.accepted).toEqual([]);
  });
});

describe("computeFunnelReached", () => {
  it("lists ids per step, nested from applied to accepted", () => {
    const apps = [
      { id: "a1", stage: "Accepted" as const },
      { id: "a2", stage: "Interview" as const },
      { id: "a3", stage: "New" as const },
    ];
    expect(computeFunnelReached(apps, [])).toEqual({
      applied: ["a1", "a2", "a3"],
      interview: ["a1", "a2"],
      accepted: ["a1"],
    });
  });
});

describe("computeFunnelSteps and formatFunnelValue", () => {
  const reached = {
    applied: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s"],
    interview: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
    accepted: ["a", "b", "c", "d", "e", "f"],
  };

  it("reports counts and the share of the stage before", () => {
    const steps = computeFunnelSteps(reached);
    expect(steps.map((s) => s.label)).toEqual(["Applied", "Reached interview", "Accepted"]);
    expect(steps.map((s) => s.count)).toEqual([19, 11, 6]);
    expect(steps.map(formatFunnelValue)).toEqual(["19", "11 · 58%", "6 · 55%"]);
  });

  it("has no conversion when the previous step is empty", () => {
    const steps = computeFunnelSteps({ applied: [], interview: [], accepted: [] });
    expect(steps.map(formatFunnelValue)).toEqual(["0", "0", "0"]);
  });
});

describe("barPercent", () => {
  it("scales to the max with a visible floor for non-zero values", () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(3, 0)).toBe(0);
  });
});

describe("formatMedianDays", () => {
  it("rounds to one decimal and pluralizes", () => {
    expect(formatMedianDays(null)).toBe("—");
    expect(formatMedianDays(1)).toBe("1 day");
    expect(formatMedianDays(12.34)).toBe("12.3 days");
  });
});

describe("topWithRemainder", () => {
  const rows = [10, 9, 8, 7, 6, 5, 4].map((n) => ({ totalCents: n * 100 }));

  it("splits the top rows from a count and total of the rest", () => {
    const result = topWithRemainder(rows, 5);
    expect(result.top).toHaveLength(5);
    expect(result.moreCount).toBe(2);
    expect(result.moreCents).toBe(900);
  });

  it("has no remainder when everything fits", () => {
    expect(topWithRemainder(rows.slice(0, 3), 5)).toMatchObject({ moreCount: 0, moreCents: 0 });
  });
});

describe("reportSourceHref", () => {
  it("links to the board with source and term", () => {
    expect(reportSourceHref("Form", "t1")).toBe("/core/partners?source=Form&term=t1");
  });

  it("omits the term for all time", () => {
    expect(reportSourceHref("Form", null)).toBe("/core/partners?source=Form");
  });
});

describe("splitPercent", () => {
  it("sums to 100 and handles zero", () => {
    expect(splitPercent(1, 2)).toEqual([33, 67]);
    expect(splitPercent(0, 0)).toEqual([0, 0]);
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
