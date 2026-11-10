import { describe, expect, it } from "vitest";
import { decisionTermFor, planRenewalConversion, type RenewalApp, type TermRef } from "../lib/renewal-conversion";

const term = (code: string, sortKey: number, start: string): TermRef => ({
  id: `t-${code}`,
  code,
  sortKey,
  startDate: new Date(start),
});

const T26S = term("26S", 262, "2026-03-30");
const T26X = term("26X", 263, "2026-06-22");
const T26F = term("26F", 264, "2026-09-14");
const T27W = term("27W", 271, "2027-01-04");
const ALL = [T26S, T26X, T26F, T27W];

const app = (over: Partial<RenewalApp> = {}): RenewalApp => ({
  id: "app1",
  title: "Renew: Seed bank catalog",
  stage: "Accepted",
  rejectReason: null,
  feeCents: 2_500_000,
  createdAt: new Date("2026-10-20"),
  ...over,
});

describe("decisionTermFor", () => {
  it("picks the term after the latest one the project had started", () => {
    expect(decisionTermFor([T26X, T26F], ALL, new Date("2026-10-20"))?.code).toBe("27W");
  });

  it("ignores project terms that hadn't started when the renewal was created", () => {
    expect(decisionTermFor([T26F, T27W], ALL, new Date("2026-10-20"))?.code).toBe("27W");
  });

  it("returns null when no project term had started", () => {
    expect(decisionTermFor([T27W], ALL, new Date("2026-10-20"))).toBeNull();
  });

  it("returns null when there is no later term", () => {
    expect(decisionTermFor([T27W], ALL, new Date("2027-02-01"))).toBeNull();
  });
});

describe("planRenewalConversion", () => {
  it("turns an accepted renewal into a continuing decision with its fee", () => {
    expect(
      planRenewalConversion({ app: app(), projectId: "p1", decisionTerm: T27W, existingDecision: false }),
    ).toEqual({ kind: "decide", termId: "t-27W", termCode: "27W", isContinuing: true, reason: null, feeCents: 2_500_000 });
  });

  it("turns a rejected renewal into a not-continuing decision with the reject reason", () => {
    expect(
      planRenewalConversion({
        app: app({ stage: "Rejected", rejectReason: "Funding" }),
        projectId: "p1",
        decisionTerm: T27W,
        existingDecision: false,
      }),
    ).toEqual({ kind: "decide", termId: "t-27W", termCode: "27W", isContinuing: false, reason: "Funding", feeCents: null });
  });

  it("closes renewals that were still open", () => {
    for (const stage of ["Backlog", "New", "Interview", "Deciding"] as const) {
      expect(
        planRenewalConversion({ app: app({ stage }), projectId: "p1", decisionTerm: T27W, existingDecision: false }),
      ).toEqual({ kind: "close" });
    }
  });

  it("never overwrites a decision that already exists", () => {
    expect(
      planRenewalConversion({ app: app(), projectId: "p1", decisionTerm: T27W, existingDecision: true }).kind,
    ).toBe("skip");
  });

  it("skips a decided renewal it can't tie to a project or term", () => {
    expect(planRenewalConversion({ app: app(), projectId: null, decisionTerm: T27W, existingDecision: false }).kind).toBe("skip");
    expect(planRenewalConversion({ app: app(), projectId: "p1", decisionTerm: null, existingDecision: false }).kind).toBe("skip");
  });
});
