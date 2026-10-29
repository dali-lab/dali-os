import { describe, it, expect } from "vitest";
import {
  addDomainRole,
  centsToDollars,
  classifyDecision,
  continueStatusWrites,
  dollarsToCents,
  groupRenewals,
  isContactStale,
  isNextStepOverdue,
  matchesRenewalQuery,
  nextTerm,
  normalizeNextStep,
  dueToInput,
  normalizeRoles,
  rolesLabel,
  spotsHeader,
  stepSlots,
  totalSlots,
  withPendingDecision,
  type RenewalCardModel,
} from "../partner-renewals";

const NOW = new Date("2026-10-28T12:00:00Z");

const card = (o: Partial<RenewalCardModel>): RenewalCardModel => ({
  projectId: "p",
  name: "Alpha",
  iconEmoji: null,
  orgName: "Acme",
  termCount: 2,
  column: "undecided",
  fromTermCode: null,
  nextStep: null,
  nextStepDueAt: null,
  lastContactAt: null,
  reason: null,
  feeCents: null,
  lastRoles: [],
  decidedRoles: [],
  ...o,
});

describe("classifyDecision", () => {
  it("is undecided with no row at the decision term", () => {
    expect(classifyDecision([], 271).column).toBe("undecided");
    expect(classifyDecision([{ sortKey: 273, code: "27F", isContinuing: true }], 271).column).toBe("undecided");
  });
  it("is continuing when the decision term is true", () => {
    expect(classifyDecision([{ sortKey: 271, code: "27W", isContinuing: true }], 271)).toEqual({
      column: "continuing",
      fromTermCode: null,
      effectiveCode: "27W",
    });
  });
  it("shows a skipped term as continuing from the later term", () => {
    const rows = [
      { sortKey: 271, code: "27W", isContinuing: false },
      { sortKey: 274, code: "27F", isContinuing: true },
    ];
    expect(classifyDecision(rows, 271)).toEqual({
      column: "continuing",
      fromTermCode: "27F",
      effectiveCode: "27F",
    });
  });
  it("is not continuing when only a false row exists", () => {
    expect(classifyDecision([{ sortKey: 271, code: "27W", isContinuing: false }], 271).column).toBe(
      "not_continuing",
    );
  });
});

describe("classifyDecision with an undecided row", () => {
  it("treats a null decision as undecided even when a later term continues", () => {
    const rows = [
      { sortKey: 271, code: "27W", isContinuing: null },
      { sortKey: 274, code: "27F", isContinuing: true },
    ];
    expect(classifyDecision(rows, 271)).toEqual({ column: "undecided", fromTermCode: null, effectiveCode: null });
  });
});

describe("normalizeNextStep", () => {
  it("drops the due date when there is no step", () => {
    expect(normalizeNextStep("  ", "2026-11-02")).toEqual({ nextStep: null, nextStepDueAt: null });
  });
  it("trims the step and parses the due date as UTC midnight", () => {
    expect(normalizeNextStep(" Call them ", "2026-11-02")).toEqual({
      nextStep: "Call them",
      nextStepDueAt: new Date("2026-11-02T00:00:00.000Z"),
    });
  });
  it("ignores a malformed due date", () => {
    expect(normalizeNextStep("Call", "11/02").nextStepDueAt).toBeNull();
    expect(normalizeNextStep("Call", "2026-13-45").nextStepDueAt).toBeNull();
  });
});

describe("dueToInput", () => {
  it("returns the date part or empty", () => {
    expect(dueToInput("2026-11-02T00:00:00.000Z")).toBe("2026-11-02");
    expect(dueToInput(null)).toBe("");
  });
});

describe("spots", () => {
  const roles = [
    { domainId: "e", name: "Engineering", slots: 2 },
    { domainId: "p", name: "Product", slots: 1 },
  ];
  it("labels and totals", () => {
    expect(rolesLabel("26F", roles)).toBe("26F: Engineering 2, Product 1");
    expect(rolesLabel("26F", [])).toBe("26F: none requested");
    expect(totalSlots(roles)).toBe(3);
  });
  it("pluralizes the header", () => {
    expect(spotsHeader(10, "26F")).toBe("10 spots in 26F");
    expect(spotsHeader(1, "27W")).toBe("1 spot in 27W");
  });
});

describe("warnings", () => {
  it("flags a past next step", () => {
    expect(isNextStepOverdue("2026-10-27T00:00:00Z", NOW)).toBe(true);
    expect(isNextStepOverdue("2026-10-28T00:00:00Z", NOW)).toBe(false);
    expect(isNextStepOverdue(null, NOW)).toBe(false);
  });
  it("flags contact older than staleDays", () => {
    expect(isContactStale("2026-10-10T12:00:00Z", 14, NOW)).toBe(true);
    expect(isContactStale("2026-10-20T12:00:00Z", 14, NOW)).toBe(false);
    expect(isContactStale(null, 14, NOW)).toBe(false);
  });
});

describe("board helpers", () => {
  it("matches query on project or partner name", () => {
    expect(matchesRenewalQuery(card({}), "acm")).toBe(true);
    expect(matchesRenewalQuery(card({}), "alp")).toBe(true);
    expect(matchesRenewalQuery(card({}), "zzz")).toBe(false);
    expect(matchesRenewalQuery(card({}), "  ")).toBe(true);
  });
  it("groups by column sorted by name", () => {
    const g = groupRenewals([
      card({ projectId: "b", name: "Beta" }),
      card({ projectId: "a", name: "Alpha" }),
      card({ projectId: "c", column: "continuing" }),
    ]);
    expect(g.undecided.map((c) => c.projectId)).toEqual(["a", "b"]);
    expect(g.continuing).toHaveLength(1);
    expect(g.not_continuing).toHaveLength(0);
  });
  it("finds the term after the picked one", () => {
    const terms = [{ sortKey: 262 }, { sortKey: 271 }, { sortKey: 274 }];
    expect(nextTerm(terms, 262)).toEqual({ sortKey: 271 });
    expect(nextTerm(terms, 274)).toBeNull();
  });
});

describe("continue writes", () => {
  it("writes one row for the decision term", () => {
    expect(continueStatusWrites("t1", "t1")).toEqual([{ termId: "t1", isContinuing: true }]);
  });
  it("writes the skipped term as not continuing", () => {
    expect(continueStatusWrites("t1", "t3")).toEqual([
      { termId: "t1", isContinuing: false },
      { termId: "t3", isContinuing: true },
    ]);
  });
  it("normalizes roles", () => {
    expect(
      normalizeRoles([
        { domainId: "a", slots: 1 },
        { domainId: "a", slots: 2 },
        { domainId: "b", slots: 0 },
        { domainId: "", slots: 3 },
        { domainId: "c", slots: 1.9 },
      ]),
    ).toEqual([
      { domainId: "a", slots: 3 },
      { domainId: "c", slots: 1 },
    ]);
  });
});

describe("form helpers", () => {
  it("converts fees", () => {
    expect(dollarsToCents("$1,250.50")).toBe(125050);
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents("-5")).toBeNull();
    expect(centsToDollars(125000)).toBe("1250");
    expect(centsToDollars(null)).toBe("");
  });
  it("steps and drops roles", () => {
    const roles = [{ domainId: "a", name: "A", slots: 1 }];
    expect(stepSlots(roles, "a", 1)[0].slots).toBe(2);
    expect(stepSlots(roles, "a", -1)).toEqual([]);
  });
  it("adds a domain once", () => {
    const once = addDomainRole([], "a", "A");
    expect(once).toEqual([{ domainId: "a", name: "A", slots: 1 }]);
    expect(addDomainRole(once, "a", "A")).toBe(once);
  });
});

describe("withPendingDecision", () => {
  const cards = [card({ projectId: "p1", column: "undecided" }), card({ projectId: "p2", column: "undecided" })];

  it("moves the card being saved into its target column", () => {
    expect(withPendingDecision(cards, { intent: "continue", projectId: "p1" }).map((c) => c.column)).toEqual([
      "continuing",
      "undecided",
    ]);
    expect(withPendingDecision(cards, { intent: "not-continuing", projectId: "p2" })[1]!.column).toBe("not_continuing");
  });

  it("leaves the board alone when nothing is saving or the intent is unknown", () => {
    expect(withPendingDecision(cards, null)).toBe(cards);
    expect(withPendingDecision(cards, { intent: "other", projectId: "p1" })).toBe(cards);
  });
});
