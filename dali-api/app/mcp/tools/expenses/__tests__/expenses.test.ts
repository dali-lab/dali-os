import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
  createFromReceipts: vi.fn(),
  createNoReceipt: vi.fn(),
  updateExpense: vi.fn(),
  submitExpense: vi.fn(),
  withdrawExpense: vi.fn(),
  deleteDraft: vi.fn(),
  decideExpense: vi.fn(),
  markPaid: vi.fn(),
  matchCharge: vi.fn(),
  unmatchCharge: vi.fn(),
  getExpense: vi.fn(),
  listExpenses: vi.fn(),
  listCategories: vi.fn(),
  listCards: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  archiveCard: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  archiveCategory: vi.fn(),
  importStatement: vi.fn(),
  listCharges: vi.fn(),
}));
const viewerMod = vi.hoisted(() => ({ loadExpenseViewer: vi.fn() }));
const s3 = vi.hoisted(() => ({
  isS3Configured: vi.fn(() => true),
  getUploadPost: vi.fn(async (key: string) => ({ url: "https://s3.test", fields: { key } })),
  headObject: vi.fn(),
  getObjectBytes: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
  putObject: vi.fn(async () => undefined),
  getDownloadUrl: vi.fn(async () => "https://s3.test/dl"),
}));
const exp = vi.hoisted(() => ({ exportExpensesCsv: vi.fn(), exportExpensesPdf: vi.fn() }));

vi.mock("~/expenses/lib/expenses.server", () => svc);
vi.mock("~/expenses/lib/viewer.server", () => viewerMod);
vi.mock("~/expenses/lib/export.server", () => exp);
vi.mock("~/lib/s3.server", () => s3);

import { ExpenseError } from "~/expenses/lib/errors";
import { FEATURE_FLAGS } from "~/lib/feature-flags";
import { validateInput } from "~/lib/mcp-input";
import type { McpCtx } from "~/mcp/registry";
import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "~/mcp/errors";
import { EXPENSES_TOOLS } from "..";

const ctx: McpCtx = {
  user: { id: "u1", daliEmail: "ada@example.edu", dartmouthEmail: null, netId: null, firstName: "Ada", lastName: "L" },
  scopes: ["mcp:read", "mcp:write"],
  request: new Request("http://x/mcp", { method: "POST" }),
};
const viewer = { userId: "u1", isCore: false, isStaff: false, ownedCardIds: [] as string[] };

const tool = (name: string) => {
  const t = EXPENSES_TOOLS.find((x) => x.def.name === name);
  if (!t) throw new Error(name);
  return t;
};
const call = (name: string, args: Record<string, unknown>) => tool(name).run(ctx, args);

beforeEach(() => {
  vi.clearAllMocks();
  viewerMod.loadExpenseViewer.mockResolvedValue(viewer);
  s3.isS3Configured.mockReturnValue(true);
});

describe("tool definitions", () => {
  it("registers every expected tool behind the expenses flag", () => {
    expect(EXPENSES_TOOLS.map((t) => t.def.name).sort()).toEqual(
      [
        "list_expenses", "get_expense", "create_expense_receipt_upload", "manage_expense", "decide_expense",
        "list_expense_categories", "list_expense_cards", "manage_expense_card", "manage_expense_category",
        "create_card_statement_upload", "import_card_statement", "list_card_charges", "export_expenses",
      ].sort(),
    );
    expect(EXPENSES_TOOLS.every((t) => t.featureFlag === "expenses")).toBe(true);
    expect(FEATURE_FLAGS.some((f) => f.key === "expenses")).toBe(true);
  });

  it("uses read scope for reads and write scope for writes", () => {
    const scopes = Object.fromEntries(EXPENSES_TOOLS.map((t) => [t.def.name, t.def.requiredScope]));
    expect(scopes).toMatchObject({
      list_expenses: "mcp:read", get_expense: "mcp:read", list_expense_categories: "mcp:read",
      list_expense_cards: "mcp:read", list_card_charges: "mcp:read", export_expenses: "mcp:read",
      create_expense_receipt_upload: "mcp:write", manage_expense: "mcp:write", decide_expense: "mcp:write",
      manage_expense_card: "mcp:write", manage_expense_category: "mcp:write",
      create_card_statement_upload: "mcp:write", import_card_statement: "mcp:write",
    });
  });

  it("has no em dashes in descriptions", () => {
    for (const t of EXPENSES_TOOLS) expect(t.def.description).not.toContain("—");
  });

  it("rejects bad input at the schema", () => {
    const ok = (n: string, input: Record<string, unknown>) => validateInput(input, tool(n).def.inputSchema).ok;
    expect(ok("manage_expense", { action: "submit", expenseId: "e1" })).toBe(true);
    expect(ok("manage_expense", { action: "explode" })).toBe(false);
    expect(ok("manage_expense", { action: "submit", extra: 1 })).toBe(false);
    expect(ok("decide_expense", { expenseId: "e1", decision: "approve" })).toBe(true);
    expect(ok("decide_expense", { expenseId: "e1", decision: "maybe" })).toBe(false);
    expect(ok("list_expenses", { scope: "everyone" })).toBe(false);
    expect(ok("import_card_statement", { cardId: "c", key: "k", mapping: { date: "d" } })).toBe(false);
    expect(ok("manage_expense_card", { action: "create", last4: "12345" })).toBe(false);
  });
});

describe("list_expenses", () => {
  it("defaults to mine, parses dates and returns decimal strings", async () => {
    svc.listExpenses.mockResolvedValue([{ id: "e1", totalCents: 1250, merchant: "Shop" }]);
    const r = (await call("list_expenses", { from: "2026-09-01", status: ["DRAFT"] })) as { expenses: unknown[] };
    expect(svc.listExpenses).toHaveBeenCalledWith(viewer, "mine", expect.objectContaining({ from: new Date("2026-09-01T00:00:00Z"), status: ["DRAFT"] }));
    expect(r.expenses).toEqual([{ id: "e1", total: "12.50", merchant: "Shop" }]);
  });

  it("rejects a bad date", async () => {
    await expect(call("list_expenses", { to: "yesterday" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("maps a scope the viewer lacks to forbidden", async () => {
    svc.listExpenses.mockRejectedValue(new ExpenseError("forbidden", "Only Core can see every expense."));
    await expect(call("list_expenses", { scope: "all" })).rejects.toBeInstanceOf(McpForbiddenError);
  });
});

describe("get_expense", () => {
  it("returns the detail with money as decimals", async () => {
    svc.getExpense.mockResolvedValue({ id: "e1", totalCents: null, statementCharge: { id: "c", amountCents: 500 } });
    expect(await call("get_expense", { expenseId: "e1" })).toEqual({ id: "e1", total: null, statementCharge: { id: "c", amount: "5.00" } });
    expect(svc.getExpense).toHaveBeenCalledWith(viewer, "e1");
  });

  it("hides an expense the caller can't see as not found", async () => {
    svc.getExpense.mockRejectedValue(new ExpenseError("not_found", "Expense not found."));
    await expect(call("get_expense", { expenseId: "x" })).rejects.toBeInstanceOf(McpNotFoundError);
  });
});

describe("create_expense_receipt_upload", () => {
  it("mints a key under the caller with a curl command", async () => {
    const r = (await call("create_expense_receipt_upload", { contentType: "application/pdf", fileName: "lunch receipt.pdf" })) as { key: string; curl: string };
    expect(r.key).toMatch(/^uploads\/expense-receipts\/u1\/[0-9a-f-]{36}$/);
    expect(r.curl).toContain("lunch_receipt.pdf");
    expect(s3.getUploadPost).toHaveBeenCalledWith(r.key, "application/pdf");
  });

  it("rejects HEIC and other types", async () => {
    await expect(call("create_expense_receipt_upload", { contentType: "image/heic", fileName: "a.heic" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("fails clearly when storage is off", async () => {
    s3.isS3Configured.mockReturnValue(false);
    await expect(call("create_expense_receipt_upload", { contentType: "image/png", fileName: "a.png" })).rejects.toBeInstanceOf(McpInvalidError);
  });
});

describe("manage_expense", () => {
  it("create passes receipt keys, payment and card to the service", async () => {
    svc.createFromReceipts.mockResolvedValue({ id: "e1", totalCents: 100 });
    const r = await call("manage_expense", { action: "create", receiptKeys: ["k1"], paidWith: "STAFF_CARD", cardId: "c1" });
    expect(svc.createFromReceipts).toHaveBeenCalledWith(viewer, ["k1"], { paidWith: "STAFF_CARD", cardId: "c1" });
    expect(r).toEqual({ id: "e1", total: "1.00" });
  });

  it("create without receipts or noReceipt is rejected", async () => {
    await expect(call("manage_expense", { action: "create" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("create with another user's receipt key maps forbidden", async () => {
    svc.createFromReceipts.mockRejectedValue(new ExpenseError("forbidden", "That receipt upload isn't yours."));
    await expect(call("manage_expense", { action: "create", receiptKeys: ["uploads/expense-receipts/u2/x"] })).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it("create with noReceipt needs a reason and files without receipts", async () => {
    await expect(call("manage_expense", { action: "create", noReceipt: true })).rejects.toBeInstanceOf(McpInvalidError);
    svc.createNoReceipt.mockResolvedValue({ id: "e2" });
    await call("manage_expense", { action: "create", noReceipt: true, noReceiptReason: "Lost it", total: "20", chargeId: "ch1" });
    expect(svc.createNoReceipt).toHaveBeenCalledWith(viewer, { totalCents: 2000 }, "Lost it", "ch1");
  });

  it("create_no_receipt converts money and dates", async () => {
    svc.createNoReceipt.mockResolvedValue({ id: "e2" });
    await call("manage_expense", { action: "create_no_receipt", noReceiptReason: "Online", merchant: "Shop", total: "$7.5", purchasedAt: "2026-10-02", cardId: "c1" });
    expect(svc.createNoReceipt).toHaveBeenCalledWith(
      viewer,
      { merchant: "Shop", totalCents: 750, purchasedAt: new Date("2026-10-02T00:00:00Z"), cardId: "c1" },
      "Online",
      undefined,
    );
  });

  it("update sends only the fields given", async () => {
    svc.updateExpense.mockResolvedValue({ id: "e1" });
    await call("manage_expense", { action: "update", expenseId: "e1", purpose: "Demo day", total: "12.34" });
    expect(svc.updateExpense).toHaveBeenCalledWith(viewer, "e1", { purpose: "Demo day", totalCents: 1234 });
  });

  it.each([["update"], ["submit"], ["withdraw"], ["delete"], ["mark_paid"], ["unmatch_charge"]])("%s needs expenseId", async (action) => {
    await expect(call("manage_expense", { action })).rejects.toThrow(/requires: expenseId/);
  });

  it("match_charge needs chargeId", async () => {
    await expect(call("manage_expense", { action: "match_charge", expenseId: "e1" })).rejects.toThrow(/chargeId/);
  });

  it("rejects an amount that is not a decimal string", async () => {
    await expect(call("manage_expense", { action: "update", expenseId: "e1", total: "twelve" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("routes each lifecycle action to its service function", async () => {
    for (const [action, fn] of [
      ["submit", svc.submitExpense], ["withdraw", svc.withdrawExpense], ["mark_paid", svc.markPaid], ["unmatch_charge", svc.unmatchCharge],
    ] as const) {
      fn.mockResolvedValue({ id: "e1" });
      await call("manage_expense", { action, expenseId: "e1" });
      expect(fn).toHaveBeenCalledWith(viewer, "e1");
    }
    svc.matchCharge.mockResolvedValue({ id: "e1" });
    await call("manage_expense", { action: "match_charge", expenseId: "e1", chargeId: "ch1" });
    expect(svc.matchCharge).toHaveBeenCalledWith(viewer, "e1", "ch1");
    svc.deleteDraft.mockResolvedValue(undefined);
    expect(await call("manage_expense", { action: "delete", expenseId: "e1" })).toEqual({ deleted: true, expenseId: "e1" });
  });

  it("maps service rejections: forbidden, conflict", async () => {
    svc.markPaid.mockRejectedValue(new ExpenseError("forbidden", "no"));
    await expect(call("manage_expense", { action: "mark_paid", expenseId: "e1" })).rejects.toBeInstanceOf(McpForbiddenError);
    svc.submitExpense.mockRejectedValue(new ExpenseError("invalid_status" as never, "Can't submit."));
    await expect(call("manage_expense", { action: "submit", expenseId: "e1" })).rejects.toBeInstanceOf(McpInvalidError);
  });
});

describe("decide_expense", () => {
  it("approves", async () => {
    svc.decideExpense.mockResolvedValue({ id: "e1", status: "APPROVED" });
    await call("decide_expense", { expenseId: "e1", decision: "approve" });
    expect(svc.decideExpense).toHaveBeenCalledWith(viewer, "e1", { decision: "approve", note: undefined });
  });

  it("requires a note to return", async () => {
    await expect(call("decide_expense", { expenseId: "e1", decision: "return", note: "  " })).rejects.toBeInstanceOf(McpInvalidError);
    expect(svc.decideExpense).not.toHaveBeenCalled();
  });

  it("maps self approval to forbidden", async () => {
    svc.decideExpense.mockRejectedValue(new ExpenseError("self_approval", "You can't approve your own expense."));
    await expect(call("decide_expense", { expenseId: "e1", decision: "approve" })).rejects.toBeInstanceOf(McpForbiddenError);
  });
});

describe("categories and cards", () => {
  it("lists categories", async () => {
    svc.listCategories.mockResolvedValue([{ id: "k1", label: "Food" }]);
    expect(await call("list_expense_categories", {})).toEqual({ categories: [{ id: "k1", label: "Food" }] });
    expect(svc.listCategories).toHaveBeenCalledWith({ includeArchived: false });
  });

  it("lists cards for the viewer", async () => {
    svc.listCards.mockResolvedValue([{ id: "c1" }]);
    expect(await call("list_expense_cards", { includeArchived: true })).toEqual({ cards: [{ id: "c1" }] });
    expect(svc.listCards).toHaveBeenCalledWith(viewer, { includeArchived: true });
  });

  it("manage_expense_card create, update, archive", async () => {
    svc.createCard.mockResolvedValue({ id: "c1" });
    await call("manage_expense_card", { action: "create", nickname: "Lab", last4: "1234", ownerId: "u9", holderIds: ["u2"], holderGroupIds: ["g1"] });
    expect(svc.createCard).toHaveBeenCalledWith(viewer, { nickname: "Lab", last4: "1234", ownerId: "u9", holderIds: ["u2"], holderGroupIds: ["g1"] });
    svc.updateCard.mockResolvedValue({ id: "c1" });
    await call("manage_expense_card", { action: "update", cardId: "c1", nickname: "New" });
    expect(svc.updateCard).toHaveBeenCalledWith(viewer, "c1", { nickname: "New" });
    svc.archiveCard.mockResolvedValue({ archived: false, needsConfirm: true, submittedCount: 2 });
    expect(await call("manage_expense_card", { action: "archive", cardId: "c1" })).toMatchObject({ needsConfirm: true });
    expect(svc.archiveCard).toHaveBeenCalledWith(viewer, "c1", { confirm: false });
    await call("manage_expense_card", { action: "archive", cardId: "c1", confirm: true });
    expect(svc.archiveCard).toHaveBeenLastCalledWith(viewer, "c1", { confirm: true });
  });

  it("manage_expense_card requires fields per action and maps non-Core to forbidden", async () => {
    await expect(call("manage_expense_card", { action: "create", nickname: "Lab" })).rejects.toThrow(/last4, ownerId/);
    await expect(call("manage_expense_card", { action: "archive" })).rejects.toThrow(/cardId/);
    svc.createCard.mockRejectedValue(new ExpenseError("forbidden", "Only Core can change cards and categories."));
    await expect(call("manage_expense_card", { action: "create", nickname: "Lab", last4: "1234", ownerId: "u9" })).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it("manage_expense_category create, update, archive", async () => {
    svc.createCategory.mockResolvedValue({ id: "k1" });
    await call("manage_expense_category", { action: "create", label: "Food", hints: ["pizza"], sortOrder: 2 });
    expect(svc.createCategory).toHaveBeenCalledWith(viewer, { label: "Food", hints: ["pizza"], sortOrder: 2 });
    svc.updateCategory.mockResolvedValue({ id: "k1" });
    await call("manage_expense_category", { action: "update", categoryId: "k1", chartString: "A-B" });
    expect(svc.updateCategory).toHaveBeenCalledWith(viewer, "k1", { chartString: "A-B" });
    svc.archiveCategory.mockResolvedValue({ archived: true });
    expect(await call("manage_expense_category", { action: "archive", categoryId: "k1" })).toEqual({ archived: true });
  });

  it("manage_expense_category requires fields and maps forbidden", async () => {
    await expect(call("manage_expense_category", { action: "create" })).rejects.toThrow(/label/);
    svc.archiveCategory.mockRejectedValue(new ExpenseError("forbidden", "Only Core"));
    await expect(call("manage_expense_category", { action: "archive", categoryId: "k1" })).rejects.toBeInstanceOf(McpForbiddenError);
  });
});

describe("statements", () => {
  const ownKey = "uploads/expense-statements/u1/abc.csv";

  it("create_card_statement_upload mints a csv key for the owner", async () => {
    viewerMod.loadExpenseViewer.mockResolvedValue({ ...viewer, ownedCardIds: ["c1"] });
    const r = (await call("create_card_statement_upload", { cardId: "c1", fileName: "march.csv" })) as { key: string; curl: string };
    expect(r.key).toMatch(/^uploads\/expense-statements\/u1\/[0-9a-f-]{36}\.csv$/);
    expect(r.curl).toContain("march.csv");
  });

  it("create_card_statement_upload rejects a member who doesn't own the card", async () => {
    await expect(call("create_card_statement_upload", { cardId: "c1", fileName: "march.csv" })).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it("create_card_statement_upload allows Core and rejects non-csv names", async () => {
    viewerMod.loadExpenseViewer.mockResolvedValue({ ...viewer, isCore: true });
    await expect(call("create_card_statement_upload", { cardId: "c1", fileName: "march.csv" })).resolves.toBeTruthy();
    await expect(call("create_card_statement_upload", { cardId: "c1", fileName: "march.xlsx" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("import_card_statement reads the upload, imports, then deletes it", async () => {
    s3.headObject.mockResolvedValue({ sizeBytes: 10, contentType: "text/csv" });
    s3.getObjectBytes.mockResolvedValue({ body: Buffer.from("Date,Desc,Amt\n") });
    svc.importStatement.mockResolvedValue({ imported: 3 });
    const mapping = { date: "Date", merchant: "Desc", amount: "Amt", invertSign: true };
    expect(await call("import_card_statement", { cardId: "c1", key: ownKey, mapping })).toEqual({ imported: 3 });
    expect(svc.importStatement).toHaveBeenCalledWith(viewer, "c1", "Date,Desc,Amt\n", mapping);
    expect(s3.deleteObject).toHaveBeenCalledWith(ownKey);
  });

  it("import_card_statement rejects another user's key without reading it", async () => {
    await expect(
      call("import_card_statement", { cardId: "c1", key: "uploads/expense-statements/u2/abc.csv", mapping: { date: "a", merchant: "b", amount: "c" } }),
    ).rejects.toBeInstanceOf(McpForbiddenError);
    expect(s3.headObject).not.toHaveBeenCalled();
    expect(s3.deleteObject).not.toHaveBeenCalled();
  });

  it("import_card_statement still deletes the upload when the import is refused", async () => {
    s3.headObject.mockResolvedValue({ sizeBytes: 10, contentType: "text/csv" });
    s3.getObjectBytes.mockResolvedValue({ body: Buffer.from("x") });
    svc.importStatement.mockRejectedValue(new ExpenseError("forbidden", "Only the card owner or Core can import a statement."));
    await expect(call("import_card_statement", { cardId: "c1", key: ownKey, mapping: { date: "a", merchant: "b", amount: "c" } })).rejects.toBeInstanceOf(McpForbiddenError);
    expect(s3.deleteObject).toHaveBeenCalledWith(ownKey);
  });

  it("import_card_statement reports a missing upload as invalid", async () => {
    s3.headObject.mockResolvedValue(null);
    await expect(call("import_card_statement", { cardId: "c1", key: ownKey, mapping: { date: "a", merchant: "b", amount: "c" } })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("list_card_charges returns decimals and passes filters", async () => {
    svc.listCharges.mockResolvedValue([{ id: "ch1", amountCents: 4210, state: "needs_receipt" }]);
    expect(await call("list_card_charges", { cardId: "c1", state: "needs_receipt", limit: 5 })).toEqual({
      charges: [{ id: "ch1", amount: "42.10", state: "needs_receipt" }],
    });
    expect(svc.listCharges).toHaveBeenCalledWith(viewer, "c1", { state: "needs_receipt", limit: 5 });
  });

  it("list_card_charges maps a non-owner to forbidden", async () => {
    svc.listCharges.mockRejectedValue(new ExpenseError("forbidden", "Only the card owner or Core can see a card's charges."));
    await expect(call("list_card_charges", { cardId: "c1" })).rejects.toBeInstanceOf(McpForbiddenError);
  });
});

describe("export_expenses", () => {
  it("writes a csv to S3 under the caller and returns a short-lived link", async () => {
    exp.exportExpensesCsv.mockResolvedValue("a,b\n1,2\n");
    const r = (await call("export_expenses", { format: "csv", scope: "all", from: "2026-09-01" })) as { url: string; format: string };
    expect(exp.exportExpensesCsv).toHaveBeenCalledWith(viewer, "all", expect.objectContaining({ from: new Date("2026-09-01T00:00:00Z") }));
    const [key, body, type] = s3.putObject.mock.calls[0] as unknown as [string, Uint8Array, string];
    expect(key).toMatch(/^exports\/expenses\/u1\/[0-9a-f-]{36}\.csv$/);
    expect(new TextDecoder().decode(body)).toBe("a,b\n1,2\n");
    expect(type).toBe("text/csv");
    expect(r).toMatchObject({ url: "https://s3.test/dl", format: "csv" });
    expect(s3.getDownloadUrl).toHaveBeenCalledWith(key, expect.objectContaining({ expiresIn: 300 }));
  });

  it("exports a pdf", async () => {
    exp.exportExpensesPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
    await call("export_expenses", { format: "pdf" });
    expect(exp.exportExpensesPdf).toHaveBeenCalledWith(viewer, "mine", expect.any(Object));
    expect((s3.putObject.mock.calls[0] as unknown[])[2]).toBe("application/pdf");
  });

  it("writes nothing when the scope is forbidden", async () => {
    exp.exportExpensesCsv.mockRejectedValue(new ExpenseError("forbidden", "Only Core can see every expense."));
    await expect(call("export_expenses", { format: "csv", scope: "all" })).rejects.toBeInstanceOf(McpForbiddenError);
    expect(s3.putObject).not.toHaveBeenCalled();
  });
});
