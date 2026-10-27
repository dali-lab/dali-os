import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTERS,
  buildPartnerBoard,
  filterPartnerCards,
  isPartnerFilters,
  movePartnerInBoard,
  partnerMatchesQuery,
  type PartnerCardModel,
  type PartnerFilters,
} from "../partner-board";

function card(overrides: Partial<PartnerCardModel> & { id: string }): PartnerCardModel {
  return {
    title: "Untitled",
    stage: "New",
    status: "New",
    position: 0,
    contactName: "Ada Lovelace",
    orgName: null,
    domains: [],
    targetTerms: [],
    nextStep: null,
    nextStepDueAt: null,
    lastActivityAt: new Date().toISOString(),
    holdUntil: null,
    resultingProjectId: null,
    meetingRequestedAt: null,
    pendingRequestCount: 0,
    meetingCount: 0,
    source: "Form",
    hasUnreadEmail: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildPartnerBoard", () => {
  it("groups cards into their stage column, sorted by position", () => {
    const cards = [
      card({ id: "a", stage: "New", status: "New", position: 1 }),
      card({ id: "b", stage: "New", status: "New", position: 0 }),
      card({ id: "c", stage: "Interview", status: "Interview", position: 0 }),
    ];
    const board = buildPartnerBoard(cards);
    expect(board.New.map((c) => c.id)).toEqual(["b", "a"]);
    expect(board.Interview.map((c) => c.id)).toEqual(["c"]);
    expect(board.Accepted).toEqual([]);
    expect(board.Rejected).toEqual([]);
  });
});

describe("movePartnerInBoard", () => {
  it("moves a card to a new column and keeps stage in sync with status", () => {
    const cards = [
      card({ id: "a", stage: "New", status: "New", position: 0 }),
      card({ id: "b", stage: "Interview", status: "Interview", position: 0 }),
    ];
    const { cards: next, orderedIds } = movePartnerInBoard(cards, "a", "Interview", -1);
    const moved = next.find((c) => c.id === "a")!;
    expect(moved.stage).toBe("Interview");
    expect(moved.status).toBe("Interview");
    expect(orderedIds).toEqual(["b", "a"]);
  });

  it("inserts at the target index within a column (reorder)", () => {
    const cards = [
      card({ id: "a", stage: "New", status: "New", position: 0 }),
      card({ id: "b", stage: "New", status: "New", position: 1 }),
      card({ id: "c", stage: "New", status: "New", position: 2 }),
    ];
    const { orderedIds } = movePartnerInBoard(cards, "c", "New", 0);
    expect(orderedIds).toEqual(["c", "a", "b"]);
  });

  it("renumbers positions densely 0..n in the destination column", () => {
    const cards = [
      card({ id: "a", stage: "New", status: "New", position: 5 }),
      card({ id: "b", stage: "Interview", status: "Interview", position: 9 }),
    ];
    const { cards: next } = movePartnerInBoard(cards, "a", "Interview", 0);
    const interview = next
      .filter((c) => c.stage === "Interview")
      .sort((x, y) => x.position - y.position);
    expect(interview.map((c) => [c.id, c.position])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });
});

describe("partnerMatchesQuery", () => {
  const c = card({
    id: "a",
    title: "Gallery kiosk",
    contactName: "Grace Hopper",
    orgName: "Acme Co",
    domains: [{ id: "d1", name: "Mobile" }],
    nextStep: "Send contract",
  });

  it("matches on title, contact, org, domain, and next step (case-insensitive)", () => {
    expect(partnerMatchesQuery(c, "gallery")).toBe(true);
    expect(partnerMatchesQuery(c, "HOPPER")).toBe(true);
    expect(partnerMatchesQuery(c, "acme")).toBe(true);
    expect(partnerMatchesQuery(c, "mobile")).toBe(true);
    expect(partnerMatchesQuery(c, "contract")).toBe(true);
  });

  it("empty query matches everything", () => {
    expect(partnerMatchesQuery(c, "")).toBe(true);
    expect(partnerMatchesQuery(c, "   ")).toBe(true);
  });

  it("no match returns false", () => {
    expect(partnerMatchesQuery(c, "nonexistent")).toBe(false);
  });

  it("handles a null orgName without throwing", () => {
    const noOrg = card({ id: "b", orgName: null });
    expect(partnerMatchesQuery(noOrg, "anything")).toBe(false);
  });
});

describe("filterPartnerCards", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const opts = { staleDays: 14, currentTermStartIso: "2026-09-01T00:00:00Z", now };
  const run = (cards: PartnerCardModel[], f: Partial<PartnerFilters> = {}, q = "") =>
    filterPartnerCards(cards, { ...DEFAULT_FILTERS, ...f }, q, opts).map((c) => c.id);

  it("keeps everything recent on the defaults", () => {
    expect(run([card({ id: "a" }), card({ id: "b", stage: "Accepted", status: "Accepted" })])).toEqual(["a", "b"]);
  });

  it("filters by term, domain and source", () => {
    const cards = [
      card({ id: "a", targetTerms: [{ id: "t1", code: "26F" }], domains: [{ id: "dev", name: "Dev" }], source: "Email" }),
      card({ id: "b", targetTerms: [{ id: "t2", code: "27W" }], domains: [{ id: "ux", name: "UX" }] }),
    ];
    expect(run(cards, { term: "t1" })).toEqual(["a"]);
    expect(run(cards, { domain: "ux" })).toEqual(["b"]);
    expect(run(cards, { source: "Email" })).toEqual(["a"]);
  });

  it("stale only keeps open, unpaused applications quiet past the threshold", () => {
    const old = "2026-09-01T00:00:00Z";
    const cards = [
      card({ id: "stale", lastActivityAt: old }),
      card({ id: "fresh", lastActivityAt: "2026-10-19T00:00:00Z" }),
      card({ id: "paused", lastActivityAt: old, holdUntil: "2026-12-01T00:00:00Z" }),
      card({ id: "hold-over", lastActivityAt: old, holdUntil: "2026-10-01T00:00:00Z" }),
      card({ id: "accepted", lastActivityAt: old, stage: "Accepted", status: "Accepted" }),
    ];
    expect(run(cards, { staleOnly: true })).toEqual(["stale", "hold-over"]);
  });

  it("hides only currently paused applications when Show paused is off", () => {
    const cards = [
      card({ id: "paused", holdUntil: "2026-12-01T00:00:00Z" }),
      card({ id: "resumed", holdUntil: "2026-10-01T00:00:00Z" }),
    ];
    expect(run(cards, { showPaused: false })).toEqual(["resumed"]);
  });

  it("hides rejections from before the current term unless asked", () => {
    const cards = [
      card({ id: "old", stage: "Rejected", status: "Rejected", lastActivityAt: "2026-08-01T00:00:00Z" }),
      card({ id: "recent", stage: "Rejected", status: "Rejected", lastActivityAt: "2026-09-15T00:00:00Z" }),
    ];
    expect(run(cards)).toEqual(["recent"]);
    expect(run(cards, { showRejectedPastTerms: true })).toEqual(["old", "recent"]);
    expect(
      filterPartnerCards(cards, DEFAULT_FILTERS, "", { ...opts, currentTermStartIso: null }).map((c) => c.id),
    ).toEqual(["old", "recent"]);
  });

  it("applies the search query", () => {
    expect(run([card({ id: "a", title: "Campus map" }), card({ id: "b" })], {}, "campus")).toEqual(["a"]);
  });
});

describe("isPartnerFilters", () => {
  it("accepts the defaults and rejects malformed values", () => {
    expect(isPartnerFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isPartnerFilters(null)).toBe(false);
    expect(isPartnerFilters({ ...DEFAULT_FILTERS, term: 3 })).toBe(false);
    expect(isPartnerFilters({ ...DEFAULT_FILTERS, staleOnly: "yes" })).toBe(false);
  });
});
