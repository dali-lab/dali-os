import { describe, expect, it } from "vitest";
import {
  NO_TERM_GROUP,
  groupPlannerRows,
  groupTotals,
  type PartnerListCard,
  type PartnerPlanningStatus,
  type PlanTermEntry,
} from "../partner-planning";

function entry(termId: string, sortKey: number, planningStatus: PartnerPlanningStatus | null = null): PlanTermEntry {
  return { targetTermId: `${termId}-tt`, termId, code: termId, sortKey, planningStatus, plannerNotes: null, plannerTodo: null };
}

function card(id: string, plan: PlanTermEntry[], extra: Partial<PartnerListCard> = {}): PartnerListCard {
  return {
    id, title: id, stage: "New", status: "New", position: 0, contactName: "Ada", orgName: null,
    domains: [], targetTerms: plan.map((e) => ({ id: e.termId, code: e.code })), nextStep: null,
    nextStepDueAt: null, lastActivityAt: "2026-10-01T00:00:00Z", holdUntil: null, resultingProjectId: null,
    meetingRequestedAt: null, pendingRequestCount: 0, meetingCount: 0, source: "Form", hasUnreadEmail: false,
    createdAt: "2026-10-01T00:00:00Z", partnerName: "Ada", feeCents: null, plan, headcount: [],
    ...extra,
  };
}

describe("groupPlannerRows", () => {
  it("with a single term, yields one group of that term's entries", () => {
    const cards = [card("a", [entry("26F", 1), entry("27W", 2)]), card("b", [entry("27W", 2)]), card("c", [])];
    const groups = groupPlannerRows(cards, "26F", null);
    expect(groups.map((g) => g.key)).toEqual(["26F"]);
    expect(groups[0].rows.map((r) => [r.card.id, r.entry?.termId])).toEqual([["a", "26F"]]);
  });

  it("with All, groups by term newest first and puts termless applications last", () => {
    const cards = [card("a", [entry("26F", 1), entry("27W", 2)]), card("b", [entry("27W", 2)]), card("c", [])];
    const groups = groupPlannerRows(cards, null, null);
    expect(groups.map((g) => [g.key, g.label, g.rows.map((r) => r.card.id)])).toEqual([
      ["27W", "27W", ["a", "b"]],
      ["26F", "26F", ["a"]],
      [NO_TERM_GROUP, "No target term", ["c"]],
    ]);
    expect(groups[2].rows[0].entry).toBeNull();
  });

  it("orders Continuing, New, Maybe, no status, then Later, and by title within a status", () => {
    const cards = [
      card("later", [entry("t", 1, "Later")]),
      card("unset", [entry("t", 1)]),
      card("maybe", [entry("t", 1, "Maybe")]),
      card("new-b", [entry("t", 1, "New")]),
      card("new-a", [entry("t", 1, "New")]),
      card("continuing", [entry("t", 1, "Continuing")]),
    ];
    expect(groupPlannerRows(cards, "t", null)[0].rows.map((r) => r.card.id)).toEqual([
      "continuing", "new-a", "new-b", "maybe", "unset", "later",
    ]);
  });

  it("filters by plan status per term entry, with Unset matching no status and termless rows", () => {
    const cards = [card("a", [entry("26F", 1, "Later"), entry("27W", 2)]), card("c", [])];
    expect(groupPlannerRows(cards, null, "Later").map((g) => [g.key, g.rows.map((r) => r.card.id)])).toEqual([["26F", ["a"]]]);
    expect(groupPlannerRows(cards, null, "Unset").map((g) => [g.key, g.rows.map((r) => r.card.id)])).toEqual([
      ["27W", ["a"]],
      [NO_TERM_GROUP, ["c"]],
    ]);
  });

  it("drops groups the status filter empties", () => {
    expect(groupPlannerRows([card("a", [entry("t", 1, "New")])], null, "Maybe")).toEqual([]);
  });
});

describe("groupTotals", () => {
  it("sums fees and per-domain headcount, treating a missing fee as zero", () => {
    const rows = [
      { card: card("a", [], { feeCents: 500, headcount: [{ id: "1", domainId: "dev", expectedMembers: 2 }] }), entry: null },
      { card: card("b", [], { headcount: [{ id: "2", domainId: "dev", expectedMembers: 3 }, { id: "3", domainId: "ux", expectedMembers: 1 }] }), entry: null },
    ];
    const totals = groupTotals(rows);
    expect(totals.feeCents).toBe(500);
    expect(Object.fromEntries(totals.members)).toEqual({ dev: 5, ux: 1 });
  });
});
