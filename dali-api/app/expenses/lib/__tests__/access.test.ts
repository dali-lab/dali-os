import { describe, expect, it } from "vitest";
import {
  canApproveExpense,
  canFileOnCard,
  canImportStatement,
  canManageCards,
  canMarkPaid,
  canMatchCharge,
  canViewCard,
  canViewExpense,
  expenseTabs,
  type ExpenseRef,
  type ExpenseViewer,
} from "../access";

const viewer = (over: Partial<ExpenseViewer> = {}): ExpenseViewer => ({
  userId: "u",
  isCore: false,
  isStaff: false,
  ownedCardIds: [],
  ...over,
});
const staffCard: ExpenseRef = { submitterId: "filer", paidWith: "STAFF_CARD", cardId: "c1" };
const ownCard: ExpenseRef = { submitterId: "filer", paidWith: "OWN_CARD", cardId: null };

describe("canViewExpense", () => {
  it("allows the filer, the card owner, staff and Core", () => {
    expect(canViewExpense(viewer({ userId: "filer" }), staffCard)).toBe(true);
    expect(canViewExpense(viewer({ ownedCardIds: ["c1"] }), staffCard)).toBe(true);
    expect(canViewExpense(viewer({ isStaff: true }), staffCard)).toBe(true);
    expect(canViewExpense(viewer({ isCore: true }), ownCard)).toBe(true);
  });
  it("gives other members, attendees and card holders nothing", () => {
    expect(canViewExpense(viewer(), staffCard)).toBe(false);
    expect(canViewExpense(viewer({ ownedCardIds: ["c2"] }), staffCard)).toBe(false);
  });
  it("does not let a card owner see own-card expenses", () => {
    expect(canViewExpense(viewer({ ownedCardIds: ["c1"] }), ownCard)).toBe(false);
  });
});

describe("canApproveExpense", () => {
  it("lets the card owner approve staff card spend", () => {
    expect(canApproveExpense(viewer({ ownedCardIds: ["c1"] }), staffCard)).toBe(true);
  });
  it("lets staff approve either kind", () => {
    expect(canApproveExpense(viewer({ isStaff: true }), staffCard)).toBe(true);
    expect(canApproveExpense(viewer({ isStaff: true }), ownCard)).toBe(true);
  });
  it("never lets the filer approve, even as staff or card owner", () => {
    expect(canApproveExpense(viewer({ userId: "filer", isStaff: true }), staffCard)).toBe(false);
    expect(canApproveExpense(viewer({ userId: "filer", ownedCardIds: ["c1"] }), staffCard)).toBe(false);
  });
  it("does not let Core alone approve", () => {
    expect(canApproveExpense(viewer({ isCore: true }), staffCard)).toBe(false);
  });
  it("does not let a card owner approve other cards or own-card expenses", () => {
    expect(canApproveExpense(viewer({ ownedCardIds: ["c2"] }), staffCard)).toBe(false);
    expect(canApproveExpense(viewer({ ownedCardIds: ["c1"] }), { ...ownCard, cardId: "c1" })).toBe(false);
  });
  it("routes an archived card to staff only", () => {
    const archived = { ...staffCard, cardArchived: true };
    expect(canApproveExpense(viewer({ ownedCardIds: ["c1"] }), archived)).toBe(false);
    expect(canApproveExpense(viewer({ isStaff: true }), archived)).toBe(true);
  });
});

describe("other permissions", () => {
  it("matches charges for the card owner and Core only, on staff card spend", () => {
    expect(canMatchCharge(viewer({ ownedCardIds: ["c1"] }), staffCard)).toBe(true);
    expect(canMatchCharge(viewer({ isCore: true }), staffCard)).toBe(true);
    expect(canMatchCharge(viewer({ isStaff: true }), staffCard)).toBe(false);
    expect(canMatchCharge(viewer({ isCore: true }), ownCard)).toBe(false);
  });
  it("marks paid for staff or the filer", () => {
    expect(canMarkPaid(viewer({ isStaff: true }), ownCard)).toBe(true);
    expect(canMarkPaid(viewer({ userId: "filer" }), ownCard)).toBe(true);
    expect(canMarkPaid(viewer({ isCore: true }), ownCard)).toBe(false);
  });
  it("shows a card to Core and its owner", () => {
    expect(canViewCard(viewer({ isCore: true }), "c1")).toBe(true);
    expect(canViewCard(viewer({ ownedCardIds: ["c1"] }), "c1")).toBe(true);
    expect(canViewCard(viewer({ ownedCardIds: ["c2"] }), "c1")).toBe(false);
    expect(canImportStatement(viewer(), "c1")).toBe(false);
  });
  it("manages cards for Core only", () => {
    expect(canManageCards(viewer({ isCore: true }))).toBe(true);
    expect(canManageCards(viewer({ ownedCardIds: ["c1"], isStaff: true }))).toBe(false);
  });
  it("lets the owner and holders file on an active card", () => {
    const card = { id: "c1", ownerId: "o", holderIds: ["h"], archivedAt: null };
    expect(canFileOnCard(viewer({ userId: "o" }), card)).toBe(true);
    expect(canFileOnCard(viewer({ userId: "h" }), card)).toBe(true);
    expect(canFileOnCard(viewer({ userId: "x" }), card)).toBe(false);
    expect(canFileOnCard(viewer({ userId: "h" }), { ...card, archivedAt: new Date() })).toBe(false);
  });
});

describe("expenseTabs", () => {
  it("gives every member only their own tab", () => {
    expect(expenseTabs(viewer())).toEqual({ yours: true, approvals: false, all: false, cards: false });
  });
  it("gives card owners approvals and cards", () => {
    expect(expenseTabs(viewer({ ownedCardIds: ["c1"] }))).toEqual({ yours: true, approvals: true, all: false, cards: true });
  });
  it("gives Core all and cards but not approvals", () => {
    expect(expenseTabs(viewer({ isCore: true }))).toEqual({ yours: true, approvals: false, all: true, cards: true });
  });
  it("gives staff approvals and all", () => {
    const t = expenseTabs(viewer({ isStaff: true }));
    expect(t.approvals).toBe(true);
    expect(t.all).toBe(true);
  });
});
