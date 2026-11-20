import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    expenseCard: { findMany: vi.fn() },
    expenseCategory: { findMany: vi.fn() },
    expense: { findFirst: vi.fn() },
  },
  requireMobileUser: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
  isImpersonating: vi.fn(),
  impersonationAllowsWrites: vi.fn(),
  loadExpenseViewer: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("~/lib/roles", () => ({ getUserRoles: m.getUserRoles }));
vi.mock("~/lib/auth", () => ({ isImpersonating: m.isImpersonating, impersonationAllowsWrites: m.impersonationAllowsWrites }));
vi.mock("~/lib/mobile-auth.server", async () => ({
  requireMobileUser: m.requireMobileUser,
  mobileError: (error: string, status: number) =>
    Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
}));
vi.mock("../expenses.server", () => ({ loadExpenseViewer: m.loadExpenseViewer }));
vi.mock("~/lib/s3.server", () => ({ getUploadPost: vi.fn() }));

import { BadRequestError } from "~/lib/http-error";
import { ExpenseError } from "../errors";
import { ReceiptKeyError } from "../receipts.server";
import { mobileExpenseError, mobileOptions, requireMobileExpenses, toMobileDetail, toMobileSummary } from "../mobile.server";

const req = (method = "GET") => new Request("https://os.example.edu/api/mobile/expenses", { method });
const body = (r: Response) => r.json();

describe("mobileExpenseError", () => {
  it.each([
    [new ExpenseError("not_found", "Expense not found."), 404, "Expense not found."],
    [new ExpenseError("forbidden", "Only Core can change cards and categories."), 403, "Only Core can change cards and categories."],
    [new ExpenseError("invalid", "Say why there is no receipt."), 400, "Say why there is no receipt."],
    [new ExpenseError("conflict", "This expense just changed. Reload and try again."), 409, "This expense just changed. Reload and try again."],
    [new ReceiptKeyError("That receipt upload isn't yours."), 400, "That receipt upload isn't yours."],
  ])("keeps the mobile error shape for %s", async (err, status, message) => {
    const res = mobileExpenseError(err);
    expect(res.status).toBe(status);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await body(res)).toEqual({ error: message });
  });

  it("rethrows errors that are not HTTP errors", () => {
    const boom = new Error("boom");
    expect(() => mobileExpenseError(boom)).toThrow(boom);
  });

  it("answers any HttpError with its status", async () => {
    expect(mobileExpenseError(new BadRequestError("Bad")).status).toBe(400);
  });
});

describe("requireMobileExpenses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.requireMobileUser.mockResolvedValue({ ok: true, userId: "u1", auth: {} });
    m.getUserRoles.mockResolvedValue({ isLabMemberOrAlum: true, isAlumni: false });
    m.isFeatureEnabled.mockResolvedValue(true);
    m.loadExpenseViewer.mockResolvedValue({ userId: "u1" });
  });

  it("passes through a failed mobile sign-in", async () => {
    const response = new Response(null, { status: 401 });
    m.requireMobileUser.mockResolvedValue({ ok: false, response });
    expect(await requireMobileExpenses(req())).toEqual({ ok: false, response });
  });

  it("returns the viewer for a member with the flag on", async () => {
    expect(await requireMobileExpenses(req())).toEqual({ ok: true, userId: "u1", viewer: { userId: "u1" } });
  });

  it("404s alumni, non-members and a flag that is off", async () => {
    m.getUserRoles.mockResolvedValue({ isLabMemberOrAlum: true, isAlumni: true });
    const alumni = await requireMobileExpenses(req());
    expect(alumni.ok === false && alumni.response.status).toBe(404);
    m.getUserRoles.mockResolvedValue({ isLabMemberOrAlum: false, isAlumni: false });
    const outsider = await requireMobileExpenses(req());
    expect(outsider.ok === false && outsider.response.status).toBe(404);
    m.getUserRoles.mockResolvedValue({ isLabMemberOrAlum: true, isAlumni: false });
    m.isFeatureEnabled.mockResolvedValue(false);
    const off = await requireMobileExpenses(req());
    expect(off.ok === false && (await body(off.response))).toEqual({ error: "Not found" });
  });

  it("blocks writes while impersonating but allows reads", async () => {
    m.isImpersonating.mockReturnValue(true);
    m.impersonationAllowsWrites.mockReturnValue(false);
    const write = await requireMobileExpenses(req("POST"));
    expect(write.ok === false && write.response.status).toBe(403);
    expect(write.ok === false && (await body(write.response))).toEqual({
      error: "Expenses can't be changed while viewing as someone else.",
    });
    expect((await requireMobileExpenses(req("GET"))).ok).toBe(true);
  });
});

const detail = (o: Record<string, unknown> = {}) =>
  ({
    id: "e1",
    status: "RETURNED",
    paidWith: "OWN_CARD",
    card: { id: "c1", nickname: "Lab", last4: "1234", extra: "x" },
    merchant: "Shop",
    purpose: "Supplies",
    category: { id: "k1", label: "Food", extra: "x" },
    totalCents: 1250,
    purchasedAt: new Date("2026-11-01T00:00:00Z"),
    noReceipt: false,
    statementChargeId: null,
    categoryId: "k1",
    suggestion: { categoryId: "k1", reason: "Looks like food" },
    decisionNote: "Add the itemized receipt",
    checks: [
      { level: "ok", message: "Total matches" },
      { level: "error", message: "Date is old" },
    ],
    receipts: [
      { id: "r1", kind: "ITEMIZED", url: "/r1", contentType: "image/png", extracted: { lineItems: [{ description: "Pizza", amountCents: 1250 }] } },
      { id: "r2", kind: "PROOF", url: null, contentType: "image/png", extracted: null },
    ],
    ...o,
  }) as never;

describe("toMobileSummary and toMobileDetail", () => {
  it("projects only the mobile fields, with money as decimal strings", () => {
    expect(toMobileSummary(detail())).toEqual({
      id: "e1",
      status: "RETURNED",
      paidWith: "OWN_CARD",
      card: { id: "c1", nickname: "Lab", last4: "1234" },
      merchant: "Shop",
      purpose: "Supplies",
      category: { id: "k1", label: "Food" },
      total: "12.50",
      purchasedAt: "2026-11-01T00:00:00.000Z",
      noReceipt: false,
      matched: false,
      receiptCount: 2,
    });
  });

  it("handles missing card, category, amount and date", () => {
    const s = toMobileSummary(detail({ card: null, category: null, totalCents: null, purchasedAt: null, statementChargeId: "s1" }));
    expect(s).toMatchObject({ card: null, category: null, total: null, purchasedAt: null, matched: true });
  });

  it("adds line items, the suggestion reason, checks, receipts with urls and the return note", () => {
    const d = toMobileDetail(detail());
    expect(d.lineItems).toEqual([{ description: "Pizza", amount: "12.50" }]);
    expect(d.categoryReason).toBe("Looks like food");
    expect(d.checks).toEqual([
      { level: "ok", message: "Total matches" },
      { level: "warn", message: "Date is old" },
    ]);
    expect(d.receipts).toEqual([{ id: "r1", kind: "ITEMIZED", url: "/r1", contentType: "image/png" }]);
    expect(d.decisionNote).toBe("Add the itemized receipt");
  });

  it("hides the reason when the category was changed, and the note unless returned", () => {
    const d = toMobileDetail(detail({ categoryId: "other", status: "SUBMITTED" }));
    expect(d.categoryReason).toBeNull();
    expect(d.decisionNote).toBeNull();
    expect(toMobileDetail(detail({ suggestion: null })).categoryReason).toBeNull();
  });
});

describe("mobileOptions", () => {
  it("lists the viewer's active cards and categories and their last payment choice", async () => {
    m.prisma.expenseCard.findMany.mockResolvedValue([{ id: "c1", nickname: "Lab", last4: "1234" }]);
    m.prisma.expenseCategory.findMany.mockResolvedValue([{ id: "k1", label: "Food" }]);
    m.prisma.expense.findFirst.mockResolvedValue({ paidWith: "STAFF_CARD", cardId: "c1" });
    const out = await mobileOptions({ userId: "u1", groupIds: ["g1"] } as never);
    expect(out).toEqual({
      cards: [{ id: "c1", nickname: "Lab", last4: "1234" }],
      categories: [{ id: "k1", label: "Food" }],
      lastPaidWith: { paidWith: "STAFF_CARD", cardId: "c1" },
    });
    expect(m.prisma.expenseCard.findMany.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      OR: [{ ownerId: "u1" }, { holderIds: { has: "u1" } }, { holderGroupIds: { hasSome: ["g1"] } }],
    });
    expect(m.prisma.expenseCategory.findMany.mock.calls[0][0].where).toEqual({ archivedAt: null });
  });

  it("returns null when the viewer has never chosen how they paid", async () => {
    m.prisma.expenseCard.findMany.mockResolvedValue([]);
    m.prisma.expenseCategory.findMany.mockResolvedValue([]);
    m.prisma.expense.findFirst.mockResolvedValue(null);
    expect((await mobileOptions({ userId: "u1" } as never)).lastPaidWith).toBeNull();
    expect(m.prisma.expenseCard.findMany.mock.calls.at(-1)![0].where.OR[2]).toEqual({ holderGroupIds: { hasSome: [] } });
  });
});
