import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      expense: { findUnique: fn(), findMany: fn(), create: fn(), updateMany: fn(), deleteMany: fn(), count: fn() },
      expenseReceipt: { findUnique: fn() },
      adminMembership: { findMany: fn(), findFirst: fn() },
      expenseCard: { findUnique: fn(), findMany: fn() },
      expenseCategory: { findMany: fn(), findFirst: fn() },
      term: { findFirst: fn() },
      cardStatementCharge: { findUnique: fn(), findFirst: fn(), findMany: fn() },
    },
    notify: vi.fn(),
    headObject: vi.fn(),
    getObjectBytes: vi.fn(),
    getObjectStream: vi.fn(),
    getDownloadUrl: vi.fn(),
    deleteObjects: vi.fn(),
    extractReceipts: vi.fn(),
  };
});

vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: (...a: unknown[]) => m.notify(...a) }));
vi.mock("~/lib/s3.server", () => ({
  headObject: (...a: unknown[]) => m.headObject(...a),
  getObjectBytes: (...a: unknown[]) => m.getObjectBytes(...a),
  getObjectStream: (...a: unknown[]) => m.getObjectStream(...a),
  getDownloadUrl: (...a: unknown[]) => m.getDownloadUrl(...a),
  deleteObjects: (...a: unknown[]) => m.deleteObjects(...a),
  getUploadPost: vi.fn(),
}));
vi.mock("../extract.server", async (orig) => ({
  ...(await orig<typeof import("../extract.server")>()),
  extractReceipts: (...a: unknown[]) => m.extractReceipts(...a),
}));

import type { ExpenseViewer } from "../access";
import { emptyExtraction } from "../extract.server";
import {
  ExpenseError,
  createFromReceipts,
  createNoReceipt,
  decideExpense,
  deleteDraft,
  getExpense,
  listExpenses,
  markPaid,
  matchCharge,
  openReceipt,
  receiptLink,
  submitExpense,
  unmatchCharge,
  updateExpense,
  withdrawExpense,
} from "../expenses.server";

const viewer = (over: Partial<ExpenseViewer> = {}): ExpenseViewer => ({
  userId: "other",
  isCore: false,
  isStaff: false,
  ownedCardIds: [],
  ...over,
});
const filer = viewer({ userId: "filer" });
const staff = viewer({ userId: "staff1", isStaff: true });
const owner = viewer({ userId: "owner", isStaff: true, ownedCardIds: ["c1"] });
const core = viewer({ userId: "core1", isCore: true });

const card = { id: "c1", nickname: "Programs Visa", last4: "4821", ownerId: "owner", holderGroupIds: [], archivedAt: null, defaultCategoryId: null };

function record(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    submitterId: "filer",
    status: "DRAFT",
    paidWith: "STAFF_CARD",
    cardId: "c1",
    statementChargeId: null,
    merchant: "Gnomon Copy",
    purchasedAt: new Date("2026-11-17T00:00:00Z"),
    total: { toString: () => "36.87" },
    currency: "USD",
    purpose: "Posters",
    categoryId: "cat1",
    chartString: null,
    termId: null,
    projectId: null,
    attendeeIds: [],
    noReceipt: false,
    noReceiptReason: null,
    extraction: null,
    approverId: null,
    decidedAt: null,
    decisionNote: null,
    submittedAt: null,
    paidAt: null,
    receipts: [],
    card,
    category: { id: "cat1", label: "Technigala", chartString: "20.330.161028.128512.3200" },
    submitter: { id: "filer", firstName: "Ada", lastName: "Lovelace" },
    approver: null,
    statementCharge: null,
    ...over,
  };
}

const setRecord = (over: Record<string, unknown> = {}) => m.prisma.expense.findUnique.mockResolvedValue(record(over));
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ExpenseError ? e.code : `other:${(e as Error).message}`;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.expense.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.expense.deleteMany.mockResolvedValue({ count: 1 });
  m.prisma.expense.findMany.mockResolvedValue([]);
  m.prisma.adminMembership.findMany.mockResolvedValue([{ userId: "staff1" }, { userId: "owner" }]);
  m.prisma.term.findFirst.mockResolvedValue(null);
  m.getDownloadUrl.mockResolvedValue("https://signed");
  m.notify.mockResolvedValue({});
  m.deleteObjects.mockResolvedValue(undefined);
});

describe("access to one expense", () => {
  it.each([
    ["the filer", filer],
    ["the card owner", owner],
    ["staff", staff],
    ["Core", core],
  ])("opens it for %s, with short-lived receipt URLs", async (_n, who) => {
    setRecord({ receipts: [{ id: "r1", s3Key: "uploads/expense-receipts/filer/a", contentType: "image/png", sha256: "h", kind: "ITEMIZED", extracted: null }] });
    const e = await getExpense(who, "e1");
    expect(e.receipts[0].url).toBe("https://signed");
    expect(m.getDownloadUrl).toHaveBeenCalledWith("uploads/expense-receipts/filer/a", expect.objectContaining({ expiresIn: 300 }));
  });
  it("hides it from another member, an attendee and a card holder as not found", async () => {
    setRecord({ attendeeIds: ["other"] });
    expect(await code(getExpense(viewer(), "e1"))).toBe("not_found");
    expect(m.getDownloadUrl).not.toHaveBeenCalled();
  });
  it("reports a missing expense as not found", async () => {
    m.prisma.expense.findUnique.mockResolvedValue(null);
    expect(await code(getExpense(core, "nope"))).toBe("not_found");
  });
});

describe("createFromReceipts", () => {
  const ownKey = "uploads/expense-receipts/filer/abc";

  it("rejects a key from another user before touching storage", async () => {
    expect(await code(createFromReceipts(filer, ["uploads/expense-receipts/victim/abc"]))).toBe("forbidden");
    expect(m.headObject).not.toHaveBeenCalled();
    expect(m.prisma.expense.create).not.toHaveBeenCalled();
  });
  it("rejects an empty drop and an over-long one", async () => {
    expect(await code(createFromReceipts(filer, []))).toBe("invalid");
    const many = Array.from({ length: 13 }, (_, i) => `uploads/expense-receipts/filer/${i}`);
    expect(await code(createFromReceipts(filer, many))).toBe("invalid");
  });
  it("rejects an upload that never finished and a wrong type", async () => {
    m.headObject.mockResolvedValueOnce(null);
    expect(await code(createFromReceipts(filer, [ownKey]))).toBe("invalid");
    m.headObject.mockResolvedValueOnce({ sizeBytes: 1, contentType: "image/heic" });
    expect(await code(createFromReceipts(filer, [ownKey]))).toBe("invalid");
  });
  it("rejects a staff card the filer may not use", async () => {
    m.headObject.mockResolvedValue({ sizeBytes: 3, contentType: "image/png" });
    m.getObjectBytes.mockResolvedValue({ body: Buffer.from([1, 2, 3]) });
    m.extractReceipts.mockResolvedValue(emptyExtraction(1));
    m.prisma.expenseCard.findUnique.mockResolvedValue({ ...card, holderIds: ["someone-else"] });
    expect(await code(createFromReceipts(filer, [ownKey], { paidWith: "STAFF_CARD", cardId: "c1" }))).toBe("invalid");
  });
  it("creates a draft from the extraction with a suggested category and hashed receipts", async () => {
    m.headObject.mockResolvedValue({ sizeBytes: 3, contentType: "image/png; charset=x" });
    m.getObjectBytes.mockResolvedValue({ body: Buffer.from("abc") });
    m.prisma.expenseCategory.findMany.mockResolvedValue([{ id: "tech", label: "Technigala", hints: ["poster"], archivedAt: null }]);
    const ex = emptyExtraction(1);
    ex.receipts[0] = { ...ex.receipts[0], kind: "ITEMIZED", poRef: "Technigala Nov 26", totalCents: 3687, merchant: "Gnomon Copy", date: "2026-11-17" };
    ex.expense = { ...ex.expense, amountChargedCents: 3687, merchant: "Gnomon Copy", purchasedAt: "2026-11-17", purpose: "Posters" };
    m.extractReceipts.mockResolvedValue(ex);
    m.prisma.expense.create.mockResolvedValue({ id: "e1" });
    setRecord();

    await createFromReceipts(filer, [ownKey, ownKey], { paidWith: "OWN_CARD" });

    const data = m.prisma.expense.create.mock.calls[0][0].data;
    expect(m.extractReceipts).toHaveBeenCalledTimes(1);
    expect(m.extractReceipts.mock.calls[0][1]).toHaveLength(1);
    expect(data).toMatchObject({
      submitterId: "filer",
      paidWith: "OWN_CARD",
      cardId: null,
      merchant: "Gnomon Copy",
      total: "36.87",
      categoryId: "tech",
      purpose: "Posters",
    });
    expect(data.receipts.create[0]).toMatchObject({
      s3Key: ownKey,
      contentType: "image/png",
      kind: "ITEMIZED",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(data.extraction.suggestion).toEqual({ categoryId: "tech", reason: "PO says Technigala" });
  });
  it("still creates a blank draft when extraction fails", async () => {
    m.headObject.mockResolvedValue({ sizeBytes: 3, contentType: "application/pdf" });
    m.getObjectBytes.mockResolvedValue({ body: Buffer.from("x") });
    m.prisma.expenseCategory.findMany.mockResolvedValue([]);
    m.extractReceipts.mockResolvedValue(emptyExtraction(1, "failed"));
    m.prisma.expense.create.mockResolvedValue({ id: "e1" });
    setRecord();
    await createFromReceipts(filer, [ownKey]);
    expect(m.prisma.expense.create.mock.calls[0][0].data).toMatchObject({ merchant: null, total: null, categoryId: null, paidWith: null });
  });
  it("turns a reused receipt key into a conflict", async () => {
    m.headObject.mockResolvedValue({ sizeBytes: 3, contentType: "image/png" });
    m.getObjectBytes.mockResolvedValue({ body: Buffer.from("x") });
    m.prisma.expenseCategory.findMany.mockResolvedValue([]);
    m.extractReceipts.mockResolvedValue(emptyExtraction(1));
    m.prisma.expense.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await code(createFromReceipts(filer, [ownKey]))).toBe("conflict");
  });
});

describe("createNoReceipt", () => {
  it("requires a reason", async () => {
    expect(await code(createNoReceipt(filer, { merchant: "Co-op", totalCents: 500 }, "  "))).toBe("invalid");
  });
  it("creates a flagged draft", async () => {
    m.prisma.expense.create.mockResolvedValue({ id: "e1" });
    setRecord({ noReceipt: true });
    await createNoReceipt(filer, { merchant: "Co-op", totalCents: 500, paidWith: "OWN_CARD" }, "Lost it");
    expect(m.prisma.expense.create.mock.calls[0][0].data).toMatchObject({
      noReceipt: true,
      noReceiptReason: "Lost it",
      total: "5.00",
      cardId: null,
    });
  });
  it("prefills from a statement charge and remembers it for approval", async () => {
    m.prisma.cardStatementCharge.findUnique.mockResolvedValue({
      id: "ch1",
      cardId: "c1",
      merchant: "CO-OP FOOD",
      postedAt: new Date("2026-11-16T00:00:00Z"),
      amount: { toString: () => "12.50" },
      expense: null,
    });
    m.prisma.expenseCard.findUnique.mockResolvedValue({ ...card, holderIds: ["filer"] });
    m.prisma.expense.create.mockResolvedValue({ id: "e1" });
    setRecord({ noReceipt: true });
    await createNoReceipt(filer, { purpose: "Snacks" }, "Lost it", "ch1");
    const data = m.prisma.expense.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ merchant: "CO-OP FOOD", total: "12.50", cardId: "c1", paidWith: "STAFF_CARD" });
    expect(data.extraction).toEqual({ chargeId: "ch1" });
  });
  it("rejects a charge that is taken, a refund, or on a card the filer can't use", async () => {
    const base = { id: "ch1", cardId: "c1", merchant: "X", postedAt: new Date(), amount: { toString: () => "5.00" }, expense: null };
    m.prisma.expenseCard.findUnique.mockResolvedValue({ ...card, holderIds: ["filer"] });
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce({ ...base, expense: { id: "e9" } });
    expect(await code(createNoReceipt(filer, {}, "r", "ch1"))).toBe("conflict");
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce({ ...base, amount: { toString: () => "-5.00" } });
    expect(await code(createNoReceipt(filer, {}, "r", "ch1"))).toBe("invalid");
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce(base);
    m.prisma.expenseCard.findUnique.mockResolvedValue({ ...card, holderIds: [] });
    expect(await code(createNoReceipt(filer, {}, "r", "ch1"))).toBe("invalid");
  });
});

describe("updateExpense", () => {
  it("lets the filer edit a draft and re-derives the term", async () => {
    setRecord();
    m.prisma.term.findFirst.mockResolvedValue({ id: "t1" });
    await updateExpense(filer, "e1", { merchant: " Staples ", totalCents: 1234, purchasedAt: "2026-11-02" });
    expect(m.prisma.expense.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", status: "DRAFT" },
      data: expect.objectContaining({ merchant: "Staples", total: "12.34", termId: "t1" }),
    });
  });
  it("rejects edits by someone else, and edits once approved", async () => {
    setRecord();
    expect(await code(updateExpense(staff, "e1", { purpose: "x" }))).toBe("forbidden");
    setRecord({ status: "APPROVED" });
    expect(await code(updateExpense(filer, "e1", { purpose: "x" }))).toBe("invalid_status");
    expect(m.prisma.expense.updateMany).not.toHaveBeenCalled();
  });
  it("lets an approver change only category and purpose while submitted", async () => {
    setRecord({ status: "SUBMITTED" });
    m.prisma.expenseCategory.findFirst.mockResolvedValue({ id: "cat2" });
    await updateExpense(staff, "e1", { categoryId: "cat2", purpose: "Fixed" });
    expect(m.prisma.expense.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", status: "SUBMITTED" },
      data: { categoryId: "cat2", purpose: "Fixed" },
    });
    expect(await code(updateExpense(staff, "e1", { totalCents: 100 }))).toBe("forbidden");
  });
  it("does not let the filer edit while submitted", async () => {
    setRecord({ status: "SUBMITTED" });
    expect(await code(updateExpense(filer, "e1", { purpose: "x" }))).toBe("forbidden");
  });
  it("rejects an inactive category and a zero amount", async () => {
    setRecord();
    m.prisma.expenseCategory.findFirst.mockResolvedValue(null);
    expect(await code(updateExpense(filer, "e1", { categoryId: "gone" }))).toBe("invalid");
    expect(await code(updateExpense(filer, "e1", { totalCents: 0 }))).toBe("invalid");
  });
  it("clears the card when switching to a personal card", async () => {
    setRecord();
    await updateExpense(filer, "e1", { paidWith: "OWN_CARD" });
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data).toMatchObject({ paidWith: "OWN_CARD", cardId: null });
  });
  it("reports a lost race as a conflict", async () => {
    setRecord();
    m.prisma.expense.updateMany.mockResolvedValue({ count: 0 });
    expect(await code(updateExpense(filer, "e1", { purpose: "x" }))).toBe("conflict");
  });
});

describe("submitExpense", () => {
  it("submits and notifies the card owner and staff, never the filer", async () => {
    setRecord();
    await submitExpense(filer, "e1");
    expect(m.prisma.expense.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", status: "DRAFT" },
      data: expect.objectContaining({ status: "SUBMITTED", approverId: null, decisionNote: null }),
    });
    const call = m.notify.mock.calls[0][0];
    expect(call.eventType).toBe("expense.submitted");
    expect(call.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual(["owner", "staff1"]);
    expect(call.message.link).toBe("/expenses?expense=e1");
    expect(JSON.stringify(call)).not.toContain("signed");
  });
  it("asks approvers to review a staff-card expense and approve a personal-card one", async () => {
    setRecord();
    await submitExpense(filer, "e1");
    expect(m.notify.mock.calls[0][0].message.title).toMatch(/^Expense to review: /);
    setRecord({ paidWith: "OWN_CARD", cardId: null, card: null });
    await submitExpense(filer, "e1");
    expect(m.notify.mock.calls[1][0].message.title).toMatch(/^Expense to approve: /);
  });
  it("routes an archived card's expense to staff only", async () => {
    m.prisma.adminMembership.findMany.mockResolvedValue([{ userId: "staff1" }]);
    setRecord({ card: { ...card, archivedAt: new Date() } });
    await submitExpense(filer, "e1");
    expect(m.notify.mock.calls[0][0].recipients).toEqual([{ userId: "staff1" }]);
  });
  it("keeps a card owner's own expense away from themselves", async () => {
    setRecord({ submitterId: "owner", submitter: { id: "owner", firstName: "O", lastName: "W" } });
    await submitExpense(owner, "e1");
    expect(m.notify.mock.calls[0][0].recipients).toEqual([{ userId: "staff1" }]);
  });
  it("blocks an incomplete expense", async () => {
    setRecord({ categoryId: null });
    expect(await code(submitExpense(filer, "e1"))).toBe("incomplete");
    expect(m.notify).not.toHaveBeenCalled();
  });
  it("only the filer can submit", async () => {
    setRecord();
    expect(await code(submitExpense(staff, "e1"))).toBe("forbidden");
  });
  it("still submits when notifying fails", async () => {
    setRecord();
    m.notify.mockRejectedValue(new Error("smtp"));
    expect(await code(submitExpense(filer, "e1"))).toBe("ok");
  });
});

describe("withdrawExpense and deleteDraft", () => {
  it("withdraws back to a clean draft", async () => {
    setRecord({ status: "SUBMITTED" });
    await withdrawExpense(filer, "e1");
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data).toEqual({
      status: "DRAFT",
      submittedAt: null,
      approverId: null,
      decidedAt: null,
      decisionNote: null,
    });
  });
  it("rejects withdrawing an approved expense", async () => {
    setRecord({ status: "APPROVED" });
    expect(await code(withdrawExpense(filer, "e1"))).toBe("invalid_status");
  });
  it("deletes a draft and its receipts from storage", async () => {
    setRecord({ receipts: [{ s3Key: "k1" }, { s3Key: "k2" }] });
    await deleteDraft(filer, "e1");
    expect(m.prisma.expense.deleteMany).toHaveBeenCalledWith({ where: { id: "e1", status: "DRAFT" } });
    expect(m.deleteObjects).toHaveBeenCalledWith(["k1", "k2"]);
  });
  it("won't delete a submitted expense or someone else's draft", async () => {
    setRecord({ status: "SUBMITTED" });
    expect(await code(deleteDraft(filer, "e1"))).toBe("invalid_status");
    setRecord();
    expect(await code(deleteDraft(staff, "e1"))).toBe("forbidden");
    expect(m.deleteObjects).not.toHaveBeenCalled();
  });
});

describe("decideExpense", () => {
  it("approves, snapshots the chart string and tells the filer", async () => {
    setRecord({ status: "SUBMITTED" });
    await decideExpense(owner, "e1", { decision: "approve" });
    expect(m.prisma.expense.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", status: "SUBMITTED" },
      data: expect.objectContaining({ status: "APPROVED", approverId: "owner", chartString: "20.330.161028.128512.3200" }),
    });
    expect(m.notify.mock.calls[0][0]).toMatchObject({ eventType: "expense.approved", recipients: [{ userId: "filer" }] });
  });
  it("tells the filer a staff-card expense was reviewed and a personal-card one approved", async () => {
    setRecord({ status: "SUBMITTED" });
    await decideExpense(owner, "e1", { decision: "approve" });
    expect(m.notify.mock.calls[0][0].message.title).toMatch(/^Expense reviewed: /);
    setRecord({ status: "SUBMITTED", paidWith: "OWN_CARD", cardId: null, card: null });
    await decideExpense(staff, "e1", { decision: "approve" });
    expect(m.notify.mock.calls[1][0].message.title).toMatch(/^Expense approved: /);
  });
  it("returns with a note and sends the note to the filer", async () => {
    setRecord({ status: "SUBMITTED" });
    await decideExpense(staff, "e1", { decision: "return", note: "Need the invoice" });
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data).toMatchObject({ status: "RETURNED", decisionNote: "Need the invoice" });
    expect(m.notify.mock.calls[0][0]).toMatchObject({ eventType: "expense.returned", message: expect.objectContaining({ body: "Need the invoice" }) });
  });
  it("rejects a return without a note", async () => {
    setRecord({ status: "SUBMITTED" });
    expect(await code(decideExpense(staff, "e1", { decision: "return" }))).toBe("note_required");
  });
  it("never lets the filer decide, even as staff", async () => {
    setRecord({ status: "SUBMITTED", submitterId: "staff1" });
    expect(await code(decideExpense(staff, "e1", { decision: "approve" }))).toBe("self_approval");
    expect(m.prisma.expense.updateMany).not.toHaveBeenCalled();
  });
  it("rejects Core and unrelated members", async () => {
    setRecord({ status: "SUBMITTED" });
    expect(await code(decideExpense(core, "e1", { decision: "approve" }))).toBe("forbidden");
    expect(await code(decideExpense(viewer(), "e1", { decision: "approve" }))).toBe("not_found");
  });
  it("sends an archived card's expense to staff only", async () => {
    setRecord({ status: "SUBMITTED", card: { ...card, archivedAt: new Date() } });
    expect(await code(decideExpense(viewer({ userId: "owner", ownedCardIds: ["c1"] }), "e1", { decision: "approve" }))).toBe("forbidden");
  });
  it("refuses to approve without a category", async () => {
    setRecord({ status: "SUBMITTED", category: null });
    expect(await code(decideExpense(staff, "e1", { decision: "approve" }))).toBe("incomplete");
  });
  it("links the charge a no-receipt expense was filed against when it is still free", async () => {
    setRecord({ status: "SUBMITTED", noReceipt: true, extraction: { chargeId: "ch1" } });
    m.prisma.cardStatementCharge.findFirst.mockResolvedValue({ id: "ch1" });
    await decideExpense(owner, "e1", { decision: "approve" });
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data.statementChargeId).toBe("ch1");
  });
  it("approves without the link when the charge was taken meanwhile", async () => {
    setRecord({ status: "SUBMITTED", noReceipt: true, extraction: { chargeId: "ch1" } });
    m.prisma.cardStatementCharge.findFirst.mockResolvedValue(null);
    await decideExpense(owner, "e1", { decision: "approve" });
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data).not.toHaveProperty("statementChargeId");
  });
  it("retries without the link on a unique violation", async () => {
    setRecord({ status: "SUBMITTED", extraction: { chargeId: "ch1" } });
    m.prisma.cardStatementCharge.findFirst.mockResolvedValue({ id: "ch1" });
    m.prisma.expense.updateMany.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    await decideExpense(owner, "e1", { decision: "approve" });
    expect(m.prisma.expense.updateMany).toHaveBeenCalledTimes(2);
    expect(m.prisma.expense.updateMany.mock.calls[1][0].data).not.toHaveProperty("statementChargeId");
  });
});

describe("markPaid", () => {
  const own = { status: "APPROVED", paidWith: "OWN_CARD", cardId: null, card: null };
  it("lets staff mark it paid and tells the filer", async () => {
    setRecord(own);
    await markPaid(staff, "e1");
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data).toMatchObject({ status: "PAID" });
    expect(m.notify.mock.calls[0][0]).toMatchObject({ eventType: "expense.paid", recipients: [{ userId: "filer" }] });
  });
  it("lets the filer say they got paid without notifying themselves", async () => {
    setRecord(own);
    await markPaid(filer, "e1");
    expect(m.notify).not.toHaveBeenCalled();
  });
  it("rejects staff card spend, unapproved spend and Core", async () => {
    setRecord({ status: "APPROVED" });
    expect(await code(markPaid(staff, "e1"))).toBe("wrong_flow");
    setRecord({ ...own, status: "SUBMITTED" });
    expect(await code(markPaid(staff, "e1"))).toBe("invalid_status");
    setRecord(own);
    expect(await code(markPaid(core, "e1"))).toBe("forbidden");
  });
});

describe("matchCharge and unmatchCharge", () => {
  const approved = { status: "APPROVED" };
  const charge = { id: "ch1", cardId: "c1", amount: { toString: () => "36.87" } };
  it("links a charge on the same card", async () => {
    setRecord(approved);
    m.prisma.cardStatementCharge.findUnique.mockResolvedValue(charge);
    await matchCharge(owner, "e1", "ch1");
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data).toEqual({ statementChargeId: "ch1" });
  });
  it("rejects a charge from another card, a refund, and one already matched", async () => {
    setRecord(approved);
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce({ ...charge, cardId: "c2" });
    expect(await code(matchCharge(owner, "e1", "ch1"))).toBe("invalid");
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce({ ...charge, amount: { toString: () => "-3.00" } });
    expect(await code(matchCharge(owner, "e1", "ch1"))).toBe("invalid");
    m.prisma.cardStatementCharge.findUnique.mockResolvedValueOnce(charge);
    m.prisma.expense.updateMany.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await code(matchCharge(owner, "e1", "ch1"))).toBe("conflict");
  });
  it("only the card owner or Core can match, and only approved staff card spend", async () => {
    setRecord(approved);
    expect(await code(matchCharge(staff, "e1", "ch1"))).toBe("forbidden");
    setRecord({ status: "SUBMITTED" });
    expect(await code(matchCharge(owner, "e1", "ch1"))).toBe("invalid_status");
  });
  it("unmatches a matched expense", async () => {
    setRecord({ ...approved, statementChargeId: "ch1" });
    await unmatchCharge(core, "e1");
    expect(m.prisma.expense.updateMany.mock.calls[0][0].data).toEqual({ statementChargeId: null });
  });
  it("rejects unmatching an unmatched expense", async () => {
    setRecord(approved);
    expect(await code(unmatchCharge(core, "e1"))).toBe("charge_state");
  });
});

describe("listExpenses", () => {
  const where = () => m.prisma.expense.findMany.mock.calls[0][0].where.AND;
  it("lists only the caller's expenses for mine", async () => {
    await listExpenses(filer, "mine");
    expect(where()[0]).toEqual({ submitterId: "filer" });
  });
  it("keeps the all and approvals scopes away from plain members", async () => {
    expect(await code(listExpenses(filer, "all"))).toBe("forbidden");
    expect(await code(listExpenses(filer, "approvals"))).toBe("forbidden");
    expect(m.prisma.expense.findMany).not.toHaveBeenCalled();
  });
  it("lets Core read everything but not approve", async () => {
    await listExpenses(core, "all");
    expect(where()[0]).toEqual({});
    expect(await code(listExpenses(core, "approvals"))).toBe("forbidden");
  });
  it("scopes a card owner's approvals to their active cards, excluding their own filings", async () => {
    await listExpenses(viewer({ userId: "o", ownedCardIds: ["c1"] }), "approvals");
    expect(where()[0]).toEqual({
      submitterId: { not: "o" },
      paidWith: "STAFF_CARD",
      cardId: { in: ["c1"] },
      card: { archivedAt: null },
    });
    expect(where()[1]).toEqual({ status: { in: ["SUBMITTED"] } });
  });
  it("gives staff every other person's expenses to approve", async () => {
    await listExpenses(staff, "approvals");
    expect(where()[0]).toEqual({ submitterId: { not: "staff1" } });
  });
  it("applies filters and the outstanding view", async () => {
    await listExpenses(staff, "all", { cardId: "c1", categoryId: "k", noReceipt: true, outstanding: true, status: ["APPROVED"] });
    expect(where()).toEqual(
      expect.arrayContaining([
        { status: { in: ["APPROVED"] } },
        { cardId: "c1" },
        { categoryId: "k" },
        { noReceipt: true },
        { status: "APPROVED", paidWith: "OWN_CARD" },
      ]),
    );
  });
  it("returns cents and the matched flag", async () => {
    m.prisma.expense.findMany.mockResolvedValue([{ ...record(), statementChargeId: "ch1" }]);
    const [row] = await listExpenses(filer, "mine");
    expect(row.totalCents).toBe(3687);
    expect(row.matched).toBe(true);
  });
});

describe("openReceipt", () => {
  const stored = { expenseId: "e1", s3Key: "uploads/expense-receipts/u/k", contentType: "application/pdf" };

  it("streams the file to anyone who can see the expense", async () => {
    m.prisma.expenseReceipt.findUnique.mockResolvedValue(stored);
    for (const who of [filer, staff, owner, viewer({ userId: "core", isCore: true })]) {
      setRecord();
      m.getObjectStream.mockResolvedValue(
        (async function* () {
          yield new TextEncoder().encode("%PDF-");
          yield new TextEncoder().encode("1.7");
        })(),
      );
      const opened = await openReceipt(who, "r1");
      expect(opened.contentType).toBe("application/pdf");
      expect(await new Response(opened.body).text()).toBe("%PDF-1.7");
    }
    expect(m.prisma.expenseReceipt.findUnique).toHaveBeenCalledWith({ where: { id: "r1" }, select: { expenseId: true, s3Key: true, contentType: true } });
    expect(m.getObjectStream).toHaveBeenCalledWith("uploads/expense-receipts/u/k");
  });
  it("hides it from someone who can't see the expense", async () => {
    m.prisma.expenseReceipt.findUnique.mockResolvedValue(stored);
    setRecord();
    expect(await code(openReceipt(viewer(), "r1"))).toBe("not_found");
    expect(m.getObjectStream).not.toHaveBeenCalled();
  });
  it("hides a card owner's view of another card's receipt", async () => {
    m.prisma.expenseReceipt.findUnique.mockResolvedValue(stored);
    setRecord();
    expect(await code(openReceipt(viewer({ userId: "owner2", ownedCardIds: ["c2"] }), "r1"))).toBe("not_found");
  });
  it("reports an unknown receipt or a missing file as not found", async () => {
    m.prisma.expenseReceipt.findUnique.mockResolvedValue(null);
    expect(await code(openReceipt(filer, "nope"))).toBe("not_found");
    m.prisma.expenseReceipt.findUnique.mockResolvedValue(stored);
    setRecord();
    m.getObjectStream.mockResolvedValue(null);
    expect(await code(openReceipt(filer, "r1"))).toBe("not_found");
  });
});

describe("receiptLink", () => {
  it("signs a fresh inline link for someone who can see the expense", async () => {
    m.prisma.expenseReceipt.findUnique.mockResolvedValue({ expenseId: "e1", s3Key: "k", contentType: "image/png" });
    setRecord();
    m.getDownloadUrl.mockResolvedValue("https://s3.example/k?sig");
    expect(await receiptLink(filer, "r1")).toBe("https://s3.example/k?sig");
    expect(m.getDownloadUrl).toHaveBeenCalledWith("k", { expiresIn: 300, inline: true, contentType: "image/png" });
  });
  it("signs nothing for someone who can't", async () => {
    m.prisma.expenseReceipt.findUnique.mockResolvedValue({ expenseId: "e1", s3Key: "k", contentType: "image/png" });
    setRecord();
    expect(await code(receiptLink(viewer(), "r1"))).toBe("not_found");
    expect(m.getDownloadUrl).not.toHaveBeenCalled();
  });
});
