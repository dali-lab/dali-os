import { describe, expect, it } from "vitest";
import type { ExpenseViewer } from "../access";
import {
  canTransition,
  nextStatus,
  submitBlockers,
  type ExpenseAction,
  type ExpenseState,
  type ExpenseStatusValue,
} from "../status";

const viewer = (over: Partial<ExpenseViewer> = {}): ExpenseViewer => ({
  userId: "other",
  isCore: false,
  isStaff: false,
  ownedCardIds: [],
  ...over,
});
const filer = viewer({ userId: "filer" });
const staff = viewer({ isStaff: true });
const owner = viewer({ ownedCardIds: ["c1"] });
const core = viewer({ isCore: true });

const expense = (over: Partial<ExpenseState> = {}): ExpenseState => ({
  status: "DRAFT",
  submitterId: "filer",
  paidWith: "STAFF_CARD",
  cardId: "c1",
  total: 3687,
  merchant: "Gnomon Copy",
  purchasedAt: "2026-11-17",
  categoryId: "cat",
  ...over,
});

const ok = (e: ExpenseState, a: ExpenseAction, who: ExpenseViewer, note?: string) =>
  canTransition(e, a, who, { note });
const code = (e: ExpenseState, a: ExpenseAction, who: ExpenseViewer, note?: string) => {
  const r = ok(e, a, who, note);
  return r.ok ? "ok" : r.code;
};

describe("allowed transitions", () => {
  it.each<[ExpenseStatusValue]>([["DRAFT"], ["RETURNED"]])("filer updates a %s expense", (status) => {
    expect(ok(expense({ status }), "update", filer)).toEqual({ ok: true, to: status });
  });
  it.each<[ExpenseStatusValue]>([["DRAFT"], ["RETURNED"]])("filer submits a %s expense", (status) => {
    expect(ok(expense({ status }), "submit", filer)).toEqual({ ok: true, to: "SUBMITTED" });
  });
  it("filer deletes a draft", () => {
    expect(ok(expense(), "delete", filer)).toEqual({ ok: true, to: "DELETED" });
  });
  it("filer withdraws a submitted expense back to draft", () => {
    expect(ok(expense({ status: "SUBMITTED" }), "withdraw", filer)).toEqual({ ok: true, to: "DRAFT" });
  });
  it("card owner approves staff card spend", () => {
    expect(ok(expense({ status: "SUBMITTED" }), "approve", owner)).toEqual({ ok: true, to: "APPROVED" });
  });
  it("staff approves either kind", () => {
    expect(ok(expense({ status: "SUBMITTED" }), "approve", staff).ok).toBe(true);
    expect(ok(expense({ status: "SUBMITTED", paidWith: "OWN_CARD", cardId: null }), "approve", staff).ok).toBe(true);
  });
  it("approver returns with a note", () => {
    expect(ok(expense({ status: "SUBMITTED" }), "return", staff, "Need the invoice")).toEqual({ ok: true, to: "RETURNED" });
  });
  it("approver edits coding while submitted", () => {
    expect(ok(expense({ status: "SUBMITTED" }), "update_coding", owner)).toEqual({ ok: true, to: "SUBMITTED" });
  });
  it("staff or the filer marks an approved own-card expense paid", () => {
    const e = expense({ status: "APPROVED", paidWith: "OWN_CARD", cardId: null });
    expect(ok(e, "mark_paid", staff)).toEqual({ ok: true, to: "PAID" });
    expect(ok(e, "mark_paid", filer)).toEqual({ ok: true, to: "PAID" });
  });
  it("card owner or Core matches and unmatches an approved staff card expense", () => {
    const e = expense({ status: "APPROVED" });
    expect(ok(e, "match", owner).ok).toBe(true);
    expect(ok(e, "match", core).ok).toBe(true);
    expect(ok({ ...e, hasCharge: true }, "unmatch", owner).ok).toBe(true);
  });
  it("nextStatus returns the new status or null", () => {
    expect(nextStatus(expense(), "submit", filer)).toBe("SUBMITTED");
    expect(nextStatus(expense(), "approve", staff)).toBeNull();
  });
});

describe("rejections", () => {
  const statuses: ExpenseStatusValue[] = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "PAID"];
  const allowedIn: Record<ExpenseAction, ExpenseStatusValue[]> = {
    update: ["DRAFT", "RETURNED"],
    submit: ["DRAFT", "RETURNED"],
    withdraw: ["SUBMITTED"],
    delete: ["DRAFT"],
    approve: ["SUBMITTED"],
    return: ["SUBMITTED"],
    update_coding: ["SUBMITTED"],
    mark_paid: ["APPROVED"],
    match: ["APPROVED"],
    unmatch: ["APPROVED"],
  };
  const actorFor: Record<ExpenseAction, ExpenseViewer> = {
    update: filer,
    submit: filer,
    withdraw: filer,
    delete: filer,
    approve: staff,
    return: staff,
    update_coding: staff,
    mark_paid: staff,
    match: core,
    unmatch: core,
  };

  for (const action of Object.keys(allowedIn) as ExpenseAction[]) {
    for (const status of statuses.filter((s) => !allowedIn[action].includes(s))) {
      it(`rejects ${action} while ${status}`, () => {
        const e = expense({
          status,
          paidWith: action === "mark_paid" ? "OWN_CARD" : "STAFF_CARD",
          hasCharge: action === "unmatch",
        });
        expect(code(e, action, actorFor[action], "note")).toBe("invalid_status");
      });
    }
  }

  it("rejects edits by anyone but the filer", () => {
    expect(code(expense(), "update", staff)).toBe("forbidden");
    expect(code(expense(), "submit", staff)).toBe("forbidden");
    expect(code(expense(), "delete", staff)).toBe("forbidden");
    expect(code(expense({ status: "SUBMITTED" }), "withdraw", staff)).toBe("forbidden");
  });
  it("rejects self approval and self return, even for staff and card owners", () => {
    const e = expense({ status: "SUBMITTED" });
    expect(code(e, "approve", viewer({ userId: "filer", isStaff: true }))).toBe("self_approval");
    expect(code(e, "return", viewer({ userId: "filer", ownedCardIds: ["c1"] }), "x")).toBe("self_approval");
    expect(code(e, "update_coding", viewer({ userId: "filer", isStaff: true }))).toBe("forbidden");
  });
  it("rejects deciding by someone who is not an approver", () => {
    const e = expense({ status: "SUBMITTED" });
    expect(code(e, "approve", viewer())).toBe("forbidden");
    expect(code(e, "approve", core)).toBe("forbidden");
    expect(code(e, "approve", viewer({ ownedCardIds: ["c2"] }))).toBe("forbidden");
  });
  it("sends an archived card to staff only", () => {
    const e = expense({ status: "SUBMITTED", cardArchived: true });
    expect(code(e, "approve", owner)).toBe("forbidden");
    expect(code(e, "approve", staff)).toBe("ok");
  });
  it("does not let a card owner approve an own-card expense", () => {
    const e = expense({ status: "SUBMITTED", paidWith: "OWN_CARD", cardId: null });
    expect(code(e, "approve", owner)).toBe("forbidden");
  });
  it("requires a note to return", () => {
    const e = expense({ status: "SUBMITTED" });
    expect(code(e, "return", staff)).toBe("note_required");
    expect(code(e, "return", staff, "   ")).toBe("note_required");
  });
  it("marks paid only for own-card spend", () => {
    expect(code(expense({ status: "APPROVED" }), "mark_paid", staff)).toBe("wrong_flow");
  });
  it("rejects mark paid by Core or other members", () => {
    const e = expense({ status: "APPROVED", paidWith: "OWN_CARD", cardId: null });
    expect(code(e, "mark_paid", core)).toBe("forbidden");
    expect(code(e, "mark_paid", viewer())).toBe("forbidden");
  });
  it("matches only staff card spend, by the card owner or Core", () => {
    const own = expense({ status: "APPROVED", paidWith: "OWN_CARD", cardId: null });
    expect(code(own, "match", core)).toBe("wrong_flow");
    expect(code(expense({ status: "APPROVED" }), "match", staff)).toBe("forbidden");
    expect(code(expense({ status: "APPROVED" }), "match", filer)).toBe("forbidden");
  });
  it("rejects matching twice and unmatching when unmatched", () => {
    expect(code(expense({ status: "APPROVED", hasCharge: true }), "match", core)).toBe("charge_state");
    expect(code(expense({ status: "APPROVED", hasCharge: false }), "unmatch", core)).toBe("charge_state");
  });
  it("freezes approved and paid expenses", () => {
    expect(code(expense({ status: "APPROVED" }), "update", filer)).toBe("invalid_status");
    expect(code(expense({ status: "PAID", paidWith: "OWN_CARD" }), "update", filer)).toBe("invalid_status");
  });
});

describe("submitBlockers", () => {
  it("passes a complete expense", () => {
    expect(submitBlockers(expense())).toEqual([]);
  });
  it.each([
    ["paidWith", { paidWith: null }],
    ["card", { cardId: null }],
    ["merchant", { merchant: " " }],
    ["date", { purchasedAt: null }],
    ["amount", { total: 0 }],
    ["category", { categoryId: null }],
    ["no-receipt reason", { noReceipt: true, noReceiptReason: "" }],
  ])("blocks submit without %s", (_n, over) => {
    const e = expense(over as Partial<ExpenseState>);
    expect(submitBlockers(e)).toHaveLength(1);
    expect(code(e, "submit", filer)).toBe("incomplete");
  });
  it("allows own card with no card id", () => {
    expect(submitBlockers(expense({ paidWith: "OWN_CARD", cardId: null }))).toEqual([]);
  });
});
