import { describe, expect, it } from "vitest";
import { toExpenseRow, toExpenseView } from "../view";

const person = { id: "u", firstName: "Ada", lastName: "Lovelace" };
const detail = (over: Record<string, unknown> = {}) =>
  ({
    id: "e1",
    status: "SUBMITTED",
    paidWith: "STAFF_CARD",
    cardId: "k1",
    card: { id: "k1", nickname: "Programs Visa", last4: "4821", ownerId: "o", archivedAt: null },
    merchant: "Gnomon Copy",
    purchasedAt: new Date("2026-11-17T00:00:00Z"),
    totalCents: 3687,
    purpose: "Posters",
    categoryId: "c1",
    noReceipt: false,
    noReceiptReason: null,
    decisionNote: null,
    submitterId: "u",
    submitter: person,
    approver: null,
    matched: true,
    statementCharge: { id: "ch", postedAt: new Date("2026-11-18T00:00:00Z"), merchant: "GNOMON", amountCents: 3687 },
    receipts: [
      { id: "r1", kind: "PAYMENT_PROOF", contentType: "image/jpeg", url: "u1", s3Key: "secret", extracted: { confidence: { merchant: 0.3, total: 0.9 }, lineItems: [] } },
      { id: "r2", kind: "ITEMIZED", contentType: "application/pdf", url: null, s3Key: "secret2", extracted: { lineItems: [{ description: "Posters", qty: 2, amountCents: 1381 }] } },
    ],
    checks: [],
    suggestion: { categoryId: "c1", reason: "PO says Technigala" },
    extraction: { extractionError: "failed", chargeId: "ch9" },
    ...over,
  }) as never;

describe("toExpenseView", () => {
  it("maps fields and never carries storage keys", () => {
    const v = toExpenseView(detail());
    expect(v).toMatchObject({
      purchasedAt: "2026-11-17",
      submitterName: "Ada Lovelace",
      cardLabel: "Programs Visa ··4821",
      cardOwnerId: "o",
      charge: { merchant: "GNOMON", postedAt: "2026-11-18", amountCents: 3687 },
      extractionError: "failed",
      chargeId: "ch9",
    });
    expect(JSON.stringify(v)).not.toContain("secret");
  });
  it("collects line items across receipts", () => {
    expect(toExpenseView(detail()).lineItems).toEqual([{ description: "Posters", qty: 2, amountCents: 1381 }]);
  });
  it("flags fields the reader was unsure about", () => {
    expect(toExpenseView(detail()).uncertain).toEqual(["merchant"]);
  });
  it("handles an expense with no card, charge or extraction", () => {
    const v = toExpenseView(detail({ card: null, cardId: null, statementCharge: null, extraction: null, receipts: [], purchasedAt: null }));
    expect(v).toMatchObject({ cardLabel: null, charge: null, extractionError: null, purchasedAt: null, uncertain: [], chargeId: null });
  });
  it("marks an archived card", () => {
    expect(toExpenseView(detail({ card: { id: "k1", nickname: "x", last4: "1", ownerId: "o", archivedAt: new Date() } })).cardArchived).toBe(true);
  });
});

describe("toExpenseRow", () => {
  it("summarizes a list row", () => {
    const r = toExpenseRow({
      id: "e1", merchant: "M", purpose: "P", status: "DRAFT", paidWith: "STAFF_CARD", cardId: "k1",
      card: { nickname: "Visa", last4: "1111" }, category: { label: "Technigala" }, totalCents: 100,
      purchasedAt: new Date("2026-02-03T00:00:00Z"), noReceipt: false, matched: false, submitterId: "u",
      submitter: person, receipts: [{ id: "r" }, { id: "s" }],
    } as never);
    expect(r).toMatchObject({ cardLabel: "Visa ··1111", categoryLabel: "Technigala", purchasedAt: "2026-02-03", receiptCount: 2, submitterName: "Ada Lovelace" });
  });
});
