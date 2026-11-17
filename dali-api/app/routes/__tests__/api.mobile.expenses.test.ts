import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    expenseCard: { findMany: vi.fn() },
    expenseCategory: { findMany: vi.fn() },
    expense: { findFirst: vi.fn() },
  },
}));
const requireMobileUser = vi.fn();
vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
const flag = vi.fn();
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: (...a: unknown[]) => flag(...a) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
const getUploadPost = vi.fn();
vi.mock("~/lib/s3.server", () => ({ getUploadPost: (...a: unknown[]) => getUploadPost(...a) }));
const svc = vi.hoisted(() => ({
  loadExpenseViewer: vi.fn(),
  listExpenses: vi.fn(),
  getExpense: vi.fn(),
  createFromReceipts: vi.fn(),
  updateExpense: vi.fn(),
  submitExpense: vi.fn(),
  withdrawExpense: vi.fn(),
  markPaid: vi.fn(),
  deleteDraft: vi.fn(),
}));
vi.mock("~/expenses/lib/expenses.server", () => ({ ...svc, MAX_RECEIPTS_PER_EXPENSE: 12 }));

import { prisma } from "~/lib/db.server";
import { ExpenseError } from "~/expenses/lib/errors";
import { loader as optionsLoader } from "../api.mobile.expenses.options";
import { action as uploadsAction } from "../api.mobile.expenses.uploads";
import { loader as listLoader, action as createAction } from "../api.mobile.expenses";
import { loader as detailLoader, action as detailAction } from "../api.mobile.expenses.$id";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const viewer = { userId: "u1", isCore: false, isStaff: false, ownedCardIds: [] };
const req = (method: string, body?: unknown, path = "/api/mobile/expenses") =>
  new Request(`https://os.example${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = (fn: (a: never) => unknown, request: Request, params: Record<string, string> = {}) => fn({ request, params, context: {} } as never) as Promise<Response>;

const detail = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "RETURNED",
  paidWith: "STAFF_CARD",
  card: { id: "c1", nickname: "Social", last4: "4242", ownerId: "o" },
  merchant: "Staples",
  purpose: "Posters",
  category: { id: "k1", label: "Supplies", chartString: "x" },
  totalCents: 3687,
  purchasedAt: new Date("2026-11-01T00:00:00Z"),
  noReceipt: false,
  statementChargeId: "ch1",
  decisionNote: "Add the PO",
  categoryId: "k1",
  suggestion: { categoryId: "k1", reason: "PO says Supplies" },
  checks: [
    { code: "totals_match", level: "ok", message: "Totals match" },
    { code: "unexplained_lines", level: "warning", message: "One line is unexplained" },
  ],
  receipts: [
    { id: "r1", kind: "ITEMIZED", contentType: "image/jpeg", url: "https://s3/r1", extracted: { lineItems: [{ description: "Paper", amountCents: 1200 }, { description: "Tape", amountCents: null }] } },
    { id: "r2", kind: "OTHER", contentType: "application/pdf", url: null, extracted: null },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1", auth: {} });
  flag.mockResolvedValue(true);
  svc.loadExpenseViewer.mockResolvedValue(viewer);
  getUploadPost.mockImplementation(async (key: string) => ({ url: "https://bucket", fields: { key } }));
});

describe("gating", () => {
  it("returns 404 on every route when the flag is off", async () => {
    flag.mockResolvedValue(false);
    const results = await Promise.all([
      call(optionsLoader, req("GET")),
      call(uploadsAction, req("POST", { files: [{ contentType: "image/jpeg", fileName: "a.jpg" }] })),
      call(listLoader, req("GET")),
      call(createAction, req("POST", { receiptKeys: ["k"] })),
      call(detailLoader, req("GET"), { id: "e1" }),
      call(detailAction, req("POST", { action: "submit" }), { id: "e1" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(svc.createFromReceipts).not.toHaveBeenCalled();
  });

  it("passes the member guard's response through", async () => {
    requireMobileUser.mockResolvedValue({ ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) });
    expect((await call(listLoader, req("GET"))).status).toBe(404);
    expect(svc.listExpenses).not.toHaveBeenCalled();
  });
});

describe("GET /options", () => {
  it("returns the member's cards, categories and last paid-with", async () => {
    db.expenseCard.findMany.mockResolvedValue([{ id: "c1", nickname: "Social", last4: "4242" }]);
    db.expenseCategory.findMany.mockResolvedValue([{ id: "k1", label: "Supplies" }]);
    db.expense.findFirst.mockResolvedValue({ paidWith: "STAFF_CARD", cardId: "c1" });
    const body = await (await call(optionsLoader, req("GET"))).json();
    expect(body).toEqual({
      cards: [{ id: "c1", nickname: "Social", last4: "4242" }],
      categories: [{ id: "k1", label: "Supplies" }],
      lastPaidWith: { paidWith: "STAFF_CARD", cardId: "c1" },
    });
    expect(db.expenseCard.findMany.mock.calls[0][0].where).toEqual({ archivedAt: null, OR: [{ ownerId: "u1" }, { holderIds: { has: "u1" } }] });
    expect(db.expense.findFirst.mock.calls[0][0].where).toEqual({ submitterId: "u1", paidWith: { not: null } });
  });

  it("returns null lastPaidWith for a first-time filer", async () => {
    db.expenseCard.findMany.mockResolvedValue([]);
    db.expenseCategory.findMany.mockResolvedValue([]);
    db.expense.findFirst.mockResolvedValue(null);
    expect((await (await call(optionsLoader, req("GET"))).json()).lastPaidWith).toBeNull();
  });
});

describe("POST /uploads", () => {
  it("mints keys under the caller's own prefix, in order", async () => {
    const res = await call(uploadsAction, req("POST", { files: [{ contentType: "image/jpeg", fileName: "a.jpg" }, { contentType: "application/pdf", fileName: "b.pdf" }] }));
    const { uploads } = await res.json();
    expect(uploads).toHaveLength(2);
    for (const u of uploads) {
      expect(u.key.startsWith("uploads/expense-receipts/u1/")).toBe(true);
      expect(u.url).toBe("https://bucket");
      expect(u.fields).toEqual({ key: u.key });
    }
    expect(getUploadPost.mock.calls.map((c) => c[1])).toEqual(["image/jpeg", "application/pdf"]);
  });

  it.each([
    ["HEIC", { files: [{ contentType: "image/heic", fileName: "a.heic" }] }],
    ["none", { files: [] }],
    ["too many", { files: Array.from({ length: 11 }, () => ({ contentType: "image/png", fileName: "a" })) }],
  ])("rejects %s", async (_n, body) => {
    expect((await call(uploadsAction, req("POST", body))).status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("rejects non-POST", async () => {
    expect((await call(uploadsAction, req("GET"))).status).toBe(405);
  });
});

describe("GET /expenses", () => {
  it("lists the caller's own as summaries", async () => {
    svc.listExpenses.mockResolvedValue([{ ...detail(), receipts: [{ id: "r1", kind: "ITEMIZED" }, { id: "r2", kind: "OTHER" }] }]);
    const body = await (await call(listLoader, req("GET"))).json();
    expect(svc.listExpenses).toHaveBeenCalledWith(viewer, "mine", expect.any(Object));
    expect(body.expenses[0]).toEqual({
      id: "e1",
      status: "RETURNED",
      paidWith: "STAFF_CARD",
      card: { id: "c1", nickname: "Social", last4: "4242" },
      merchant: "Staples",
      purpose: "Posters",
      category: { id: "k1", label: "Supplies" },
      total: "36.87",
      purchasedAt: "2026-11-01T00:00:00.000Z",
      noReceipt: false,
      matched: true,
      receiptCount: 2,
    });
  });
});

describe("GET /expenses/:id", () => {
  it("maps the detail to the contract", async () => {
    svc.getExpense.mockResolvedValue(detail());
    const body = await (await call(detailLoader, req("GET"), { id: "e1" })).json();
    expect(svc.getExpense).toHaveBeenCalledWith(viewer, "e1");
    expect(body.lineItems).toEqual([{ description: "Paper", amount: "12.00" }, { description: "Tape", amount: null }]);
    expect(body.categoryReason).toBe("PO says Supplies");
    expect(body.checks).toEqual([{ level: "ok", message: "Totals match" }, { level: "warn", message: "One line is unexplained" }]);
    expect(body.receipts).toEqual([{ id: "r1", kind: "ITEMIZED", url: "https://s3/r1", contentType: "image/jpeg" }]);
    expect(body.decisionNote).toBe("Add the PO");
  });

  it("hides the decision note unless returned and the reason when the category changed", async () => {
    svc.getExpense.mockResolvedValue(detail({ status: "DRAFT", categoryId: "other" }));
    const body = await (await call(detailLoader, req("GET"), { id: "e1" })).json();
    expect(body.decisionNote).toBeNull();
    expect(body.categoryReason).toBeNull();
  });

  it("maps a service not_found to 404 with { error }", async () => {
    svc.getExpense.mockRejectedValue(new ExpenseError("not_found", "Expense not found."));
    const res = await call(detailLoader, req("GET"), { id: "nope" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Expense not found." });
  });
});

describe("POST /expenses", () => {
  it("creates a draft from receipt keys and returns the detail", async () => {
    svc.createFromReceipts.mockResolvedValue({ id: "e1" });
    svc.getExpense.mockResolvedValue(detail({ status: "DRAFT" }));
    const res = await call(createAction, req("POST", { receiptKeys: ["uploads/expense-receipts/u1/a"], paidWith: "OWN_CARD" }));
    expect(res.status).toBe(201);
    expect(svc.createFromReceipts).toHaveBeenCalledWith(viewer, ["uploads/expense-receipts/u1/a"], { paidWith: "OWN_CARD", cardId: null });
    expect((await res.json()).id).toBe("e1");
  });

  it("surfaces another user's key as 403", async () => {
    svc.createFromReceipts.mockRejectedValue(new ExpenseError("forbidden", "That receipt upload isn't yours."));
    const res = await call(createAction, req("POST", { receiptKeys: ["uploads/expense-receipts/u2/a"] }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That receipt upload isn't yours." });
  });

  it("validates the body", async () => {
    expect((await call(createAction, req("POST", { receiptKeys: [] }))).status).toBe(400);
    expect((await call(createAction, req("POST", { receiptKeys: ["k"], paidWith: "CASH" }))).status).toBe(400);
    expect(svc.createFromReceipts).not.toHaveBeenCalled();
  });

  it("rejects other methods", async () => {
    expect((await call(createAction, req("PUT", {}))).status).toBe(405);
  });
});

describe("PATCH /expenses/:id", () => {
  beforeEach(() => svc.getExpense.mockResolvedValue(detail()));

  it("converts the amount and date for the service", async () => {
    const res = await call(detailAction, req("PATCH", { merchant: "Staples", total: "36.87", purchasedAt: "2026-11-01", categoryId: "k1", attendeeIds: ["a"] }), { id: "e1" });
    expect(res.status).toBe(200);
    expect(svc.updateExpense).toHaveBeenCalledWith(viewer, "e1", {
      merchant: "Staples",
      totalCents: 3687,
      purchasedAt: new Date("2026-11-01"),
      categoryId: "k1",
      attendeeIds: ["a"],
    });
  });

  it("rejects an invalid amount or date without calling the service", async () => {
    expect((await call(detailAction, req("PATCH", { total: "abc" }), { id: "e1" })).status).toBe(400);
    expect((await call(detailAction, req("PATCH", { purchasedAt: "nope" }), { id: "e1" })).status).toBe(400);
    expect(svc.updateExpense).not.toHaveBeenCalled();
  });

  it("maps a locked expense to 409", async () => {
    svc.updateExpense.mockRejectedValue(new ExpenseError("locked" as never, "This expense can't be edited right now."));
    expect((await call(detailAction, req("PATCH", { merchant: "x" }), { id: "e1" })).status).toBe(409);
  });
});

describe("POST /expenses/:id", () => {
  beforeEach(() => svc.getExpense.mockResolvedValue(detail()));

  it.each([
    ["submit", "submitExpense"],
    ["withdraw", "withdrawExpense"],
    ["markPaid", "markPaid"],
  ] as const)("%s calls the matching service", async (action, fn) => {
    const res = await call(detailAction, req("POST", { action }), { id: "e1" });
    expect(res.status).toBe(200);
    expect(svc[fn]).toHaveBeenCalledWith(viewer, "e1");
  });

  it("rejects an unknown action", async () => {
    expect((await call(detailAction, req("POST", { action: "approve" }), { id: "e1" })).status).toBe(400);
  });

  it("surfaces an incomplete submit as 400", async () => {
    svc.submitExpense.mockRejectedValue(new ExpenseError("incomplete", "Add an amount first."));
    const res = await call(detailAction, req("POST", { action: "submit" }), { id: "e1" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add an amount first." });
  });
});

describe("DELETE /expenses/:id", () => {
  it("deletes a draft", async () => {
    const res = await call(detailAction, req("DELETE"), { id: "e1" });
    expect(await res.json()).toEqual({ ok: true });
    expect(svc.deleteDraft).toHaveBeenCalledWith(viewer, "e1");
  });

  it("surfaces a refusal", async () => {
    svc.deleteDraft.mockRejectedValue(new ExpenseError("forbidden", "Only drafts can be deleted."));
    expect((await call(detailAction, req("DELETE"), { id: "e1" })).status).toBe(403);
  });
});
