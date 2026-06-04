import { describe, it, expect } from "vitest";
import {
  buildBoard,
  dedupeLiveAssignments,
  resolveAssignmentInputs,
  UNASSIGNED,
  type MemberInput,
} from "../staffing-board";

function member(overrides: Partial<MemberInput> = {}): MemberInput {
  return {
    userId: "u1",
    firstName: "Alice",
    lastName: "Anderson",
    email: "alice@dali.example",
    photoUrl: null,
    isAdmin: false,
    coreTitles: [],
    preferences: [],
    bidFields: [],
    domainLevels: [],
    ...overrides,
  };
}

describe("buildBoard", () => {
  it("initialises every column even when empty", () => {
    const board = buildBoard({
      projectIds: ["p1", "p2"],
      members: [],
      assignments: [],
    });
    expect(Object.keys(board).sort()).toEqual(["__unassigned__", "p1", "p2"].sort());
    expect(board.p1).toEqual([]);
    expect(board[UNASSIGNED]).toEqual([]);
  });

  it("puts a member with no assignment into Unassigned and tags their top-preference level", () => {
    const board = buildBoard({
      projectIds: ["p1"],
      members: [
        member({
          preferences: [
            { projectId: "p1", domainId: "d1", level: "P2", preferenceRank: 2, notes: null },
            { projectId: "p9", domainId: "d2", level: "P3", preferenceRank: 1, notes: "first pick" },
          ],
        }),
      ],
      assignments: [],
    });
    expect(board[UNASSIGNED]).toHaveLength(1);
    const card = board[UNASSIGNED][0];
    expect(card.level).toBe("P3");
    expect(card.topPreferences.map((p) => p.projectId)).toEqual(["p9", "p1"]);
  });

  it("dedupes same-project same-rank bids into one entry listing each domain", () => {
    // Gaelle's case: rank-1 bid on "Evergreen" in two domains. The card should
    // show one #1 Evergreen entry whose domainIds carry both, not two lines.
    const board = buildBoard({
      projectIds: [],
      members: [
        member({
          preferences: [
            { projectId: "evergreen", domainId: "fullstack", level: "P1", preferenceRank: 1, notes: null },
            { projectId: "evergreen", domainId: "uiux", level: "P1", preferenceRank: 1, notes: null },
            { projectId: "p2", domainId: "fullstack", level: "P1", preferenceRank: 2, notes: null },
          ],
        }),
      ],
      assignments: [],
    });
    const { topPreferences } = board[UNASSIGNED][0];
    expect(topPreferences).toEqual([
      { projectId: "evergreen", rank: 1, domainIds: ["fullstack", "uiux"] },
      { projectId: "p2", rank: 2, domainIds: ["fullstack"] },
    ]);
  });

  it("caps topPreferences at 3 distinct (project, rank) entries, not raw rows", () => {
    const board = buildBoard({
      projectIds: [],
      members: [
        member({
          preferences: [
            // Two rows for rank 1 collapse to one entry, leaving room for 2,3,4.
            { projectId: "p1", domainId: "d1", level: "P1", preferenceRank: 1, notes: null },
            { projectId: "p1", domainId: "d2", level: "P1", preferenceRank: 1, notes: null },
            { projectId: "p2", domainId: "d1", level: "P1", preferenceRank: 2, notes: null },
            { projectId: "p3", domainId: "d1", level: "P1", preferenceRank: 3, notes: null },
            { projectId: "p4", domainId: "d1", level: "P1", preferenceRank: 4, notes: null },
          ],
        }),
      ],
      assignments: [],
    });
    expect(board[UNASSIGNED][0].topPreferences.map((p) => p.projectId)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("puts an assigned member in the project column and uses the assignment's level", () => {
    const board = buildBoard({
      projectIds: ["p1"],
      members: [
        member({
          preferences: [
            { projectId: "p1", domainId: "d1", level: "P2", preferenceRank: 2, notes: null },
          ],
        }),
      ],
      assignments: [{ userId: "u1", projectId: "p1", domainId: "d1", level: "P3" }],
    });
    expect(board.p1).toHaveLength(1);
    expect(board[UNASSIGNED]).toEqual([]);
    expect(board.p1[0].level).toBe("P3");
    expect(board.p1[0].topPreferences.map((p) => p.projectId)).toEqual(["p1"]);
  });

  it("falls back to Unassigned if the assignment points at a column we're not rendering", () => {
    const board = buildBoard({
      projectIds: ["p1"],
      members: [member({ preferences: [] })],
      // p9 isn't in projectIds — stale assignment from another term, say.
      assignments: [{ userId: "u1", projectId: "p9", domainId: "d1", level: "P1" }],
    });
    expect(board[UNASSIGNED]).toHaveLength(1);
    expect(board.p1).toEqual([]);
  });

  it("sorts members by lastName then firstName", () => {
    const board = buildBoard({
      projectIds: [],
      members: [
        member({ userId: "u-b", firstName: "Z", lastName: "B" }),
        member({ userId: "u-a", firstName: "A", lastName: "A" }),
        member({ userId: "u-c", firstName: "M", lastName: "B" }),
      ],
      assignments: [],
    });
    expect(board[UNASSIGNED].map((c) => c.userId)).toEqual(["u-a", "u-c", "u-b"]);
  });

  it("defaults unresolvedBid to false for an ordinary member", () => {
    const board = buildBoard({
      projectIds: ["p1"],
      members: [member()],
      assignments: [],
    });
    expect(board[UNASSIGNED][0].unresolvedBid).toBe(false);
  });

  it("carries an unresolved-bid flag through to the Unassigned card", () => {
    // A member who bid but produced no preference: no project picks, flagged.
    const board = buildBoard({
      projectIds: ["p1"],
      members: [member({ preferences: [], unresolvedBid: true })],
      assignments: [],
    });
    expect(board[UNASSIGNED]).toHaveLength(1);
    const card = board[UNASSIGNED][0];
    expect(card.unresolvedBid).toBe(true);
    expect(card.topPreferences).toEqual([]);
    expect(card.level).toBeNull();
  });

  it("carries every domainLevel through to the card", () => {
    const board = buildBoard({
      projectIds: ["p1"],
      members: [
        member({
          domainLevels: [
            { domainId: "eng", domainName: "Engineering", level: "P3" },
            { domainId: "design", domainName: "Design", level: "P1" },
          ],
        }),
      ],
      assignments: [],
    });
    expect(board[UNASSIGNED][0].domainLevels).toEqual([
      { domainId: "eng", domainName: "Engineering", level: "P3" },
      { domainId: "design", domainName: "Design", level: "P1" },
    ]);
  });
});

describe("buildBoard cardOrder", () => {
  const m = (userId: string, lastName: string) =>
    member({ userId, firstName: userId.toUpperCase(), lastName });

  it("falls back to last-name sort when no order is given", () => {
    const board = buildBoard({
      projectIds: [],
      members: [m("c", "Carter"), m("a", "Adams"), m("b", "Baker")],
      assignments: [],
    });
    expect(board[UNASSIGNED].map((c) => c.userId)).toEqual(["a", "b", "c"]);
  });

  it("orders cards in a column by their sortKey when present", () => {
    const board = buildBoard({
      projectIds: [],
      members: [m("a", "Adams"), m("b", "Baker"), m("c", "Carter")],
      assignments: [],
      cardOrder: [
        { userId: "c", columnKey: UNASSIGNED, sortKey: 0 },
        { userId: "a", columnKey: UNASSIGNED, sortKey: 1 },
        { userId: "b", columnKey: UNASSIGNED, sortKey: 2 },
      ],
    });
    expect(board[UNASSIGNED].map((c) => c.userId)).toEqual(["c", "a", "b"]);
  });

  it("places ordered cards ahead of unordered ones (which keep name order)", () => {
    const board = buildBoard({
      projectIds: [],
      members: [m("a", "Adams"), m("b", "Baker"), m("c", "Carter")],
      assignments: [],
      // Only c has an explicit position.
      cardOrder: [{ userId: "c", columnKey: UNASSIGNED, sortKey: 0 }],
    });
    expect(board[UNASSIGNED].map((c) => c.userId)).toEqual(["c", "a", "b"]);
  });

  it("ignores an order row whose columnKey doesn't match the card's column", () => {
    // 'a' is assigned to p1, but its saved order is for Unassigned — stale, so
    // it must NOT apply in p1; p1 falls back to name order.
    const board = buildBoard({
      projectIds: ["p1"],
      members: [
        member({
          userId: "a",
          lastName: "Zimmer",
          preferences: [{ projectId: "p1", domainId: "d1", level: "P1", preferenceRank: 1, notes: null }],
        }),
        member({
          userId: "b",
          lastName: "Adams",
          preferences: [{ projectId: "p1", domainId: "d1", level: "P1", preferenceRank: 1, notes: null }],
        }),
      ],
      assignments: [
        { userId: "a", projectId: "p1", domainId: "d1", level: "P1" },
        { userId: "b", projectId: "p1", domainId: "d1", level: "P1" },
      ],
      cardOrder: [{ userId: "a", columnKey: UNASSIGNED, sortKey: 0 }],
    });
    // Name order (Adams before Zimmer) since the order row is for a stale column.
    expect(board.p1.map((c) => c.userId)).toEqual(["b", "a"]);
  });
});

describe("resolveAssignmentInputs", () => {
  it("returns the bid for the target project when present", () => {
    const out = resolveAssignmentInputs(
      member({
        preferences: [
          { projectId: "p1", domainId: "d1", level: "P2", preferenceRank: 2, notes: null },
          { projectId: "p2", domainId: "d2", level: "P1", preferenceRank: 1, notes: null },
        ],
      }),
      "p1",
    );
    expect(out).toEqual({ domainId: "d1", level: "P2" });
  });

  it("falls back to the member's top-ranked preference when they didn't bid on the target", () => {
    const out = resolveAssignmentInputs(
      member({
        preferences: [
          { projectId: "p2", domainId: "d2", level: "P1", preferenceRank: 1, notes: null },
          { projectId: "p3", domainId: "d3", level: "P2", preferenceRank: 3, notes: null },
        ],
      }),
      "p99",
    );
    expect(out).toEqual({ domainId: "d2", level: "P1" });
  });

  it("falls back to a single domain eligibility when the member has no bid", () => {
    const out = resolveAssignmentInputs(
      member({
        preferences: [],
        domainLevels: [{ domainId: "d-fs", domainName: "Fullstack", level: "P3" }],
      }),
      "p1",
    );
    expect(out).toEqual({ domainId: "d-fs", level: "P3" });
  });

  it("returns null when the member has no bid and no eligibility", () => {
    const out = resolveAssignmentInputs(member({ preferences: [], domainLevels: [] }), "p1");
    expect(out).toBeNull();
  });

  it("returns null when the member has no bid and multiple eligibilities (ambiguous)", () => {
    const out = resolveAssignmentInputs(
      member({
        preferences: [],
        domainLevels: [
          { domainId: "d1", domainName: "Eng", level: "P2" },
          { domainId: "d2", domainName: "Design", level: "P1" },
        ],
      }),
      "p1",
    );
    expect(out).toBeNull();
  });
});

describe("dedupeLiveAssignments", () => {
  const row = (userId: string, status: "Proposed" | "Confirmed", projectId: string) => ({
    userId,
    status,
    projectId,
  });

  it("keeps a lone Confirmed row so a finalized roster stays on the board", () => {
    const out = dedupeLiveAssignments([row("u1", "Confirmed", "p1")]);
    expect(out).toEqual([row("u1", "Confirmed", "p1")]);
  });

  it("prefers Proposed over Confirmed for the same user (in-progress re-edit wins)", () => {
    // User was confirmed on p1, then dragged to p2 (fresh Proposed row).
    const out = dedupeLiveAssignments([
      row("u1", "Confirmed", "p1"),
      row("u1", "Proposed", "p2"),
    ]);
    expect(out).toEqual([row("u1", "Proposed", "p2")]);
  });

  it("prefers Proposed regardless of input order", () => {
    const out = dedupeLiveAssignments([
      row("u1", "Proposed", "p2"),
      row("u1", "Confirmed", "p1"),
    ]);
    expect(out).toEqual([row("u1", "Proposed", "p2")]);
  });

  it("returns one row per user across a mixed set", () => {
    const out = dedupeLiveAssignments([
      row("u1", "Confirmed", "p1"),
      row("u2", "Proposed", "p1"),
      row("u2", "Confirmed", "p1"),
      row("u3", "Proposed", "p2"),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.userId).sort()).toEqual(["u1", "u2", "u3"]);
    expect(out.find((r) => r.userId === "u2")?.status).toBe("Proposed");
  });
});
