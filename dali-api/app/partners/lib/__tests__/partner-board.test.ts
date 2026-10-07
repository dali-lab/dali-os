import { describe, it, expect } from "vitest";
import {
  buildPartnerBoard,
  movePartnerInBoard,
  partnerMatchesQuery,
  type PartnerCardModel,
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
