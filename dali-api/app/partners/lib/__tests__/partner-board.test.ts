import { describe, it, expect } from "vitest";
import {
  DEFAULT_BOARD_PREFS,
  DEFAULT_FILTERS,
  buildPartnerBoard,
  columnFiltersFromParams,
  formatCardSpots,
  sortPartnerBoard,
  sortPartnerCards,
  SOURCE_OPTIONS,
  filterPartnerCards,
  boardPrefsFromParams,
  writeBoardPrefsParams,
  movePartnerInBoard,
  partnerCardCells,
  partnerFiltersFromColumns,
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
    feeCents: null,
    lastActivityAt: new Date().toISOString(),
    holdUntil: null,
    resultingProjectId: null,
    projectIconEmoji: null,
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
    domains: [{ id: "d1", name: "Mobile", expectedMembers: 0 }],
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

  it("filters by term, domain and source, with values in a column OR-ing together", () => {
    const cards = [
      card({ id: "a", targetTerms: [{ id: "t1", code: "26F" }], domains: [{ id: "dev", name: "Dev", expectedMembers: 0 }], source: "Email" }),
      card({ id: "b", targetTerms: [{ id: "t2", code: "27W" }], domains: [{ id: "ux", name: "UX", expectedMembers: 0 }] }),
      card({ id: "c", targetTerms: [{ id: "t3", code: "27S" }], source: "Referral" }),
    ];
    expect(run(cards, { terms: ["26F"] })).toEqual(["a"]);
    expect(run(cards, { terms: ["26F", "27W"] })).toEqual(["a", "b"]);
    expect(run(cards, { domains: ["UX"] })).toEqual(["b"]);
    expect(run(cards, { sources: ["Email", "Referral"] })).toEqual(["a", "c"]);
  });

  it("Stale keeps open, unpaused applications quiet past the threshold; Active keeps the rest", () => {
    const old = "2026-09-01T00:00:00Z";
    const cards = [
      card({ id: "stale", lastActivityAt: old }),
      card({ id: "fresh", lastActivityAt: "2026-10-19T00:00:00Z" }),
      card({ id: "paused", lastActivityAt: old, holdUntil: "2026-12-01T00:00:00Z" }),
      card({ id: "hold-over", lastActivityAt: old, holdUntil: "2026-10-01T00:00:00Z" }),
      card({ id: "accepted", lastActivityAt: old, stage: "Accepted", status: "Accepted" }),
    ];
    expect(run(cards, { activity: ["Stale"] })).toEqual(["stale", "hold-over"]);
    expect(run(cards, { activity: ["Active"] })).toEqual(["fresh", "paused", "accepted"]);
    expect(run(cards, { activity: ["Stale", "Active"] })).toHaveLength(5);
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

describe("board prefs params", () => {
  const params = (q: string) => new URLSearchParams(q);

  it("uses the defaults for a bare URL", () => {
    expect(boardPrefsFromParams(params(""))).toEqual(DEFAULT_BOARD_PREFS);
  });

  it("reads each option", () => {
    expect(boardPrefsFromParams(params("sort=fee&paused=hide&rejected=show"))).toEqual({
      sort: "fee",
      showPaused: false,
      showRejectedPastTerms: true,
    });
  });

  it("falls back to manual order for an unknown sort", () => {
    expect(boardPrefsFromParams(params("sort=bogus")).sort).toBe("manual");
  });

  it("writes only what differs from the defaults and keeps other params", () => {
    const written = writeBoardPrefsParams(params("q=acme&f.term=26F"), {
      sort: "next-step",
      showPaused: false,
      showRejectedPastTerms: true,
    });
    expect(written.toString()).toBe("q=acme&f.term=26F&sort=next-step&paused=hide&rejected=show");
    expect(writeBoardPrefsParams(written, DEFAULT_BOARD_PREFS).toString()).toBe("q=acme&f.term=26F");
  });
});

describe("partnerCardCells", () => {
  const now = new Date("2026-10-20T00:00:00Z");

  it("exposes term codes, domain names, source and the activity label", () => {
    const c = card({
      id: "a",
      targetTerms: [{ id: "t1", code: "26F" }, { id: "t2", code: "27W" }],
      domains: [{ id: "d1", name: "Dev", expectedMembers: 1 }],
      source: "Email",
      lastActivityAt: "2026-10-19T00:00:00Z",
    });
    expect(partnerCardCells(c, 14, now)).toEqual({
      term: ["26F", "27W"],
      domain: ["Dev"],
      source: "Email",
      activity: "Active",
    });
  });

  it("labels a quiet open card Stale", () => {
    const c = card({ id: "a", lastActivityAt: "2026-09-01T00:00:00Z" });
    expect(partnerCardCells(c, 14, now).activity).toBe("Stale");
  });
});

describe("partnerFiltersFromColumns", () => {
  it("maps column filters and prefs onto the board filter shape", () => {
    const active = [
      { columnKey: "term", values: ["26F"] },
      { columnKey: "source", values: ["Email", "Form"] },
      { columnKey: "activity", values: ["Stale"] },
    ];
    expect(
      partnerFiltersFromColumns(active, { sort: "manual", showPaused: false, showRejectedPastTerms: true }),
    ).toEqual({
      terms: ["26F"],
      domains: [],
      sources: ["Email", "Form"],
      activity: ["Stale"],
      showPaused: false,
      showRejectedPastTerms: true,
    });
  });
});

const ids = (cs: PartnerCardModel[]) => cs.map((c) => c.id);

describe("sortPartnerCards", () => {
  const cards = [
    card({ id: "a", nextStepDueAt: "2026-11-05T00:00:00Z", lastActivityAt: "2026-10-20T00:00:00Z", feeCents: 100 }),
    card({ id: "b", nextStepDueAt: null, lastActivityAt: "2026-09-01T00:00:00Z", feeCents: null }),
    card({ id: "c", nextStepDueAt: "2026-11-01T00:00:00Z", lastActivityAt: "2026-10-25T00:00:00Z", feeCents: 900 }),
  ];

  it("keeps the incoming order for manual", () => {
    expect(ids(sortPartnerCards(cards, "manual"))).toEqual(["a", "b", "c"]);
  });

  it("puts the soonest next step first and cards without one last", () => {
    expect(ids(sortPartnerCards(cards, "next-step"))).toEqual(["c", "a", "b"]);
  });

  it("puts the longest quiet first", () => {
    expect(ids(sortPartnerCards(cards, "last-contact"))).toEqual(["b", "a", "c"]);
  });

  it("puts the highest fee first and cards without one last", () => {
    expect(ids(sortPartnerCards(cards, "fee"))).toEqual(["c", "a", "b"]);
  });

  it("does not mutate its input", () => {
    sortPartnerCards(cards, "fee");
    expect(ids(cards)).toEqual(["a", "b", "c"]);
  });

  it("sorts every column of a board", () => {
    const board = buildPartnerBoard([
      card({ id: "x", stage: "New", status: "New", feeCents: 1 }),
      card({ id: "y", stage: "New", status: "New", feeCents: 5, position: 1 }),
      card({ id: "z", stage: "Deciding", status: "Deciding", feeCents: 2 }),
    ]);
    const sorted = sortPartnerBoard(board, "fee");
    expect(ids(sorted.New)).toEqual(["y", "x"]);
    expect(ids(sorted.Deciding)).toEqual(["z"]);
  });
});

describe("Deciding column", () => {
  it("groups Deciding cards into their own column", () => {
    const board = buildPartnerBoard([card({ id: "d", stage: "Deciding", status: "Deciding" })]);
    expect(ids(board.Deciding)).toEqual(["d"]);
  });
});

describe("formatCardSpots", () => {
  it("spells domains out with their spot counts and skips empty ones", () => {
    expect(
      formatCardSpots([
        { id: "1", name: "Engineering", expectedMembers: 2 },
        { id: "2", name: "Design", expectedMembers: 1 },
        { id: "3", name: "Strategy", expectedMembers: 0 },
      ]),
    ).toBe("Engineering 2, Design 1");
  });
});

describe("SOURCE_OPTIONS", () => {
  it("never offers Renewal", () => {
    expect(SOURCE_OPTIONS.map((s) => s.value)).not.toContain("Renewal");
  });
});

describe("columnFiltersFromParams", () => {
  const valid = { sources: ["Form", "Email"], terms: [{ id: "t1", code: "26F" }] };

  it("seeds source and term column filters from the URL, mapping term id to code", () => {
    expect(columnFiltersFromParams(new URLSearchParams("source=Form&term=t1"), valid)).toEqual([
      { columnKey: "source", values: ["Form"] },
      { columnKey: "term", values: ["26F"] },
    ]);
  });

  it("ignores unknown values", () => {
    expect(columnFiltersFromParams(new URLSearchParams("source=Bogus&term=nope"), valid)).toEqual([]);
    expect(columnFiltersFromParams(new URLSearchParams(), valid)).toEqual([]);
  });
});
