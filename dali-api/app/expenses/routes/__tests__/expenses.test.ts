import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      expense: { findFirst: fn() },
      user: { findMany: fn() },
      term: { findMany: fn() },
    },
    requireAuth: fn(),
    isNonMember: fn(),
    isImpersonating: fn(),
    impersonationAllowsWrites: fn(),
    getUserRoles: fn(),
    isFeatureEnabled: fn(),
    loadExpenseViewer: fn(),
    lib: {
      archiveCard: fn(), archiveCategory: fn(), createCard: fn(), createCategory: fn(), createFromReceipts: fn(),
      createNoReceipt: fn(), decideExpense: fn(), deleteDraft: fn(), getExpense: fn(), importStatement: fn(),
      listCards: fn(), listCategories: fn(), listCharges: fn(), listExpenses: fn(), markPaid: fn(), matchCharge: fn(),
      submitExpense: fn(), unmatchCharge: fn(), updateCard: fn(), updateCategory: fn(), updateExpense: fn(), withdrawExpense: fn(),
    },
    getChargeForFiling: fn(),
    requestReceipt: fn(),
    listAllGroups: fn(),
  };
});

vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));
vi.mock("~/lib/auth", () => ({
  requireAuth: m.requireAuth,
  isNonMember: m.isNonMember,
  isImpersonating: m.isImpersonating,
  impersonationAllowsWrites: m.impersonationAllowsWrites,
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: m.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("../../lib/viewer.server", () => ({ loadExpenseViewer: m.loadExpenseViewer }));
vi.mock("../../lib/expenses.server", () => m.lib);
vi.mock("../../lib/charge-filing.server", () => ({ getChargeForFiling: m.getChargeForFiling }));
vi.mock("../../lib/reminders.server", () => ({ requestReceipt: m.requestReceipt }));
vi.mock("~/lib/groups.server", () => ({ listAllGroups: m.listAllGroups }));
vi.mock("../../components/ExpensesPage", () => ({ ExpensesPage: () => null }));

import { ExpenseError } from "../../lib/errors";
import { action, loader, toUpdateInput } from "../expenses";

const viewer = (over = {}) => ({ userId: "u1", isCore: false, isStaff: false, ownedCardIds: [] as string[], ...over });

const run = (url: string) => loader({ request: new Request(`https://os.example${url}`) } as never);
const post = (fields: Record<string, string>) =>
  action({ request: new Request("https://os.example/expenses", { method: "POST", body: new URLSearchParams(fields) }) } as never) as Promise<Response>;
const body = async (r: Response) => (await r.json()) as Record<string, unknown>;
const thrown = async (p: Promise<unknown>) => p.then(() => null, (e) => e as Response);

const listRow = (over = {}) => ({
  id: "e1", merchant: "Gnomon", purpose: null, status: "DRAFT", paidWith: "OWN_CARD", cardId: null, card: null,
  category: null, totalCents: 100, purchasedAt: new Date("2026-11-17T00:00:00Z"), noReceipt: false, matched: false,
  submitterId: "u1", submitter: { firstName: "Ada", lastName: "Lovelace" }, receipts: [], ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  m.isNonMember.mockResolvedValue(false);
  m.isImpersonating.mockReturnValue(false);
  m.impersonationAllowsWrites.mockReturnValue(false);
  m.getUserRoles.mockResolvedValue({ isAlumni: false });
  m.isFeatureEnabled.mockResolvedValue(true);
  m.loadExpenseViewer.mockResolvedValue(viewer());
  m.lib.listCards.mockResolvedValue([]);
  m.lib.listCategories.mockResolvedValue([]);
  m.lib.listExpenses.mockResolvedValue([]);
  m.lib.submitExpense.mockResolvedValue({ paidWith: "OWN_CARD" });
  m.lib.decideExpense.mockResolvedValue({ paidWith: "OWN_CARD" });
  m.prisma.term.findMany.mockResolvedValue([]);
});

describe("loader gating", () => {
  it("redirects a signed-out visitor to log in", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    const r = await thrown(run("/expenses"));
    expect(r!.status).toBe(302);
  });
  it("sends non-members to the portal", async () => {
    m.isNonMember.mockResolvedValue(true);
    const r = await thrown(run("/expenses"));
    expect(r!.headers.get("Location")).toBe("/portal");
  });
  it("404s when the flag is off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect((await thrown(run("/expenses")))!.status).toBe(404);
    expect(m.isFeatureEnabled).toHaveBeenCalledWith("expenses", "u1", { isAlumni: false }, expect.any(Request));
  });
  it("404s for alumni", async () => {
    m.getUserRoles.mockResolvedValue({ isAlumni: true });
    expect((await thrown(run("/expenses")))!.status).toBe(404);
  });
  it.each(["approvals", "all", "cards"])("404s the %s tab for a plain member", async (tab) => {
    expect((await thrown(run(`/expenses?tab=${tab}`)))!.status).toBe(404);
  });
  it("falls back to your expenses for an unknown tab", async () => {
    const data = await run("/expenses?tab=nope");
    expect(data.tab).toBe("yours");
  });
});

describe("loader data", () => {
  it("lists your own expenses with a plain row shape", async () => {
    m.lib.listExpenses.mockResolvedValue([listRow()]);
    const data = await run("/expenses");
    expect(m.lib.listExpenses).toHaveBeenCalledWith(expect.anything(), "mine", {});
    expect(data.rows[0]).toMatchObject({ id: "e1", purchasedAt: "2026-11-17", submitterName: "Ada Lovelace" });
    expect(data.tabs).toEqual({ yours: true, approvals: false, all: false, cards: false });
  });

  it("offers only cards the viewer may file on", async () => {
    const card = (id: string, holderIds: string[], ownerId = "x") => ({
      id, nickname: id, last4: "1111", ownerId, holderIds, holderGroupIds: [], defaultCategoryId: null, archivedAt: null, owner: { firstName: "G", lastName: "H" },
    });
    m.lib.listCards.mockResolvedValue([card("mine", ["u1"]), card("theirs", [])]);
    const data = await run("/expenses");
    expect(data.fileableCards.map((c) => c.id)).toEqual(["mine"]);
  });

  it("opens the first approval when none is chosen", async () => {
    m.loadExpenseViewer.mockResolvedValue(viewer({ isStaff: true }));
    m.lib.listExpenses.mockResolvedValue([listRow({ id: "first", status: "SUBMITTED" })]);
    m.lib.getExpense.mockResolvedValue({ id: "first", status: "SUBMITTED", receipts: [], checks: [], totalCents: 1, matched: false, submitter: { firstName: "A", lastName: "B" }, approver: null, statementCharge: null, card: null, extraction: null });
    const data = await run("/expenses?tab=approvals");
    expect(m.lib.listExpenses).toHaveBeenCalledWith(expect.anything(), "approvals", {});
    expect(m.lib.getExpense).toHaveBeenCalledWith(expect.anything(), "first");
    expect(data.expense?.id).toBe("first");
  });

  it("drops an expense the viewer can't open instead of failing", async () => {
    m.lib.getExpense.mockRejectedValue(new ExpenseError("not_found", "Expense not found."));
    const data = await run("/expenses?expense=zzz");
    expect(data.expense).toBeNull();
  });

  it("passes the all-tab filters to the list", async () => {
    m.loadExpenseViewer.mockResolvedValue(viewer({ isCore: true }));
    await run("/expenses?tab=all&status=APPROVED,PAID&cardId=k1&from=2026-01-01&noReceipt=1");
    expect(m.lib.listExpenses).toHaveBeenCalledWith(expect.anything(), "all", {
      status: ["APPROVED", "PAID"], cardId: "k1", from: new Date("2026-01-01T00:00:00Z"), noReceipt: true,
    });
  });

  it("loads the charge for a needs-receipt link, and 404s when it can't be filed", async () => {
    m.getChargeForFiling.mockResolvedValue({ id: "ch1", cardId: "k1", cardNickname: "Visa", cardLast4: "1111", merchant: "GNOMON", postedAt: "2026-11-17", amountCents: 3687 });
    expect((await run("/expenses?charge=ch1")).charge?.merchant).toBe("GNOMON");
    m.getChargeForFiling.mockRejectedValue(new ExpenseError("not_found", "That charge wasn't found."));
    expect((await thrown(run("/expenses?charge=nope")))!.status).toBe(404);
  });

  it("gives a card owner the cards tab with their cards and charges", async () => {
    m.loadExpenseViewer.mockResolvedValue(viewer({ ownedCardIds: ["k1"] }));
    const card = (id: string) => ({ id, nickname: id, last4: "1", ownerId: "u1", holderIds: [], holderGroupIds: [], defaultCategoryId: null, archivedAt: null, owner: { firstName: "G", lastName: "H" } });
    m.lib.listCards.mockResolvedValue([card("k1"), card("k2")]);
    m.lib.listCharges.mockResolvedValue([
      { id: "ch1", postedAt: new Date("2026-11-17T00:00:00Z"), merchant: "GNOMON", amountCents: 100, state: "needs_receipt", expense: null },
    ]);
    const data = await run("/expenses?tab=cards&charges=needs");
    expect(data.cardsTab?.cards.map((c) => c.id)).toEqual(["k1"]);
    expect(data.cardsTab?.selectedCardId).toBe("k1");
    expect(m.lib.listCharges).toHaveBeenCalledWith(expect.anything(), "k1", { state: "needs_receipt" });
    expect(data.cardsTab?.charges[0]).toMatchObject({ id: "ch1", postedAt: "2026-11-17" });
    expect(m.prisma.user.findMany).not.toHaveBeenCalled();
    expect(m.listAllGroups).not.toHaveBeenCalled();
  });

  it("offers Core only current lab members and active lab groups as card holders", async () => {
    m.loadExpenseViewer.mockResolvedValue(viewer({ isCore: true }));
    m.lib.listCards.mockResolvedValue([]);
    m.prisma.user.findMany.mockResolvedValue([
      { id: "s1", firstName: "Grace", lastName: "Hopper", adminMembership: { isStaff: true } },
      { id: "m1", firstName: "Ada", lastName: "Lovelace", adminMembership: null },
    ]);
    const group = (id: string, systemKey: string | null, over: Record<string, unknown> = {}) => ({
      id, name: id, systemKey, memberIds: ["m1"], archived: false, ...over,
    });
    m.listAllGroups.mockResolvedValue([
      group("Term 26F", "term:t1"),
      group("Alumni", "alumni"),
      group("Course", "offering:o1"),
      group("Old crew", null, { archived: true }),
      group("Empty project", "project:p1", { memberIds: [] }),
      group("Designers", null, { memberIds: ["m1", "s1"] }),
    ]);
    const data = await run("/expenses?tab=cards");
    expect(m.prisma.user.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ daliMember: { isNot: null }, membershipStatus: "Active" }, { adminMembership: { is: { isStaff: true } } }],
    });
    expect(data.cardsTab?.members.map((p) => p.id)).toEqual(["s1", "m1"]);
    expect(data.cardsTab?.staff.map((p) => p.id)).toEqual(["s1"]);
    expect(data.cardsTab?.groups).toEqual([
      { id: "Designers", name: "Designers", memberCount: 2 },
      { id: "Term 26F", name: "Term 26F", memberCount: 1 },
    ]);
  });
});

describe("action gating", () => {
  it("404s when the flag is off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect((await post({ intent: "delete", id: "e1" })).status).toBe(404);
    expect(m.lib.deleteDraft).not.toHaveBeenCalled();
  });
  it("401s when signed out", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect((await post({ intent: "delete", id: "e1" })).status).toBe(401);
  });
  it("403s non-members", async () => {
    m.isNonMember.mockResolvedValue(true);
    expect((await post({ intent: "delete", id: "e1" })).status).toBe(403);
  });
  it("blocks writes while viewing as someone else in prod", async () => {
    m.isImpersonating.mockReturnValue(true);
    expect((await post({ intent: "delete", id: "e1" })).status).toBe(403);
    m.impersonationAllowsWrites.mockReturnValue(true);
    expect((await post({ intent: "delete", id: "e1" })).status).toBe(200);
  });
  it("rejects an unknown intent", async () => {
    expect((await post({ intent: "nope" })).status).toBe(400);
  });
  it("maps a library error to its status and message", async () => {
    m.lib.withdrawExpense.mockRejectedValue(new ExpenseError("invalid_status", "Can't withdraw an expense that is approved."));
    const r = await post({ intent: "withdraw", id: "e1" });
    expect(r.status).toBe(409);
    expect(await body(r)).toEqual({ ok: false, error: "Can't withdraw an expense that is approved." });
  });
  it.each([
    ["forbidden", 403],
    ["self_approval", 403],
    ["not_found", 404],
    ["note_required", 400],
  ] as const)("returns %s as %i", async (code, status) => {
    m.lib.decideExpense.mockRejectedValue(new ExpenseError(code, "x"));
    expect((await post({ intent: "decide", id: "e1", decision: "approve" })).status).toBe(status);
  });
  it("rethrows an unexpected error", async () => {
    m.lib.markPaid.mockRejectedValue(new Error("boom"));
    await expect(post({ intent: "mark-paid", id: "e1" })).rejects.toThrow("boom");
  });
});

describe("create", () => {
  it("creates one expense from every uploaded key", async () => {
    m.lib.createFromReceipts.mockResolvedValue({ id: "e9", paidWith: "OWN_CARD" });
    const r = await post({ intent: "create", keys: JSON.stringify(["k1", "k2"]) });
    expect(m.lib.createFromReceipts).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), ["k1", "k2"], { cardId: null, paidWith: null });
    expect(await body(r)).toEqual({ ok: true, expenseId: "e9" });
  });
  it("files on the card from a needs-receipt link", async () => {
    m.lib.createFromReceipts.mockResolvedValue({ id: "e9", paidWith: "STAFF_CARD" });
    await post({ intent: "create", keys: '["k1"]', cardId: "card1", paidWith: "STAFF_CARD" });
    expect(m.lib.createFromReceipts).toHaveBeenCalledWith(expect.anything(), ["k1"], { cardId: "card1", paidWith: "STAFF_CARD" });
  });
  it("falls back to the last way they paid when the receipt didn't say", async () => {
    m.lib.createFromReceipts.mockResolvedValue({ id: "e9", paidWith: null });
    m.prisma.expense.findFirst.mockResolvedValue({ paidWith: "STAFF_CARD", cardId: "k7" });
    await post({ intent: "create", keys: '["k1"]' });
    expect(m.lib.updateExpense).toHaveBeenCalledWith(expect.anything(), "e9", { paidWith: "STAFF_CARD", cardId: "k7" });
  });
  it("keeps the new expense when the last card can't be used any more", async () => {
    m.lib.createFromReceipts.mockResolvedValue({ id: "e9", paidWith: null });
    m.prisma.expense.findFirst.mockResolvedValue({ paidWith: "STAFF_CARD", cardId: "k7" });
    m.lib.updateExpense.mockRejectedValue(new ExpenseError("invalid", "You can't file on that card."));
    expect((await post({ intent: "create", keys: '["k1"]' })).status).toBe(200);
  });
  it("doesn't override a payment the receipt settled", async () => {
    m.lib.createFromReceipts.mockResolvedValue({ id: "e9", paidWith: "STAFF_CARD" });
    await post({ intent: "create", keys: '["k1"]' });
    expect(m.prisma.expense.findFirst).not.toHaveBeenCalled();
  });
  it("passes a rejected key through as a 403", async () => {
    m.lib.createFromReceipts.mockRejectedValue(new ExpenseError("forbidden", "That receipt upload isn't yours."));
    expect((await post({ intent: "create", keys: '["uploads/expense-receipts/other/x"]' })).status).toBe(403);
  });
  it("rejects a body that isn't JSON", async () => {
    expect((await post({ intent: "create", keys: "{" })).status).toBe(400);
  });
});

describe("no receipt", () => {
  it("creates it from the fields with a charge", async () => {
    m.lib.createNoReceipt.mockResolvedValue({ id: "e2" });
    const r = await post({ intent: "create-no-receipt", merchant: "Co-op", purchasedAt: "2026-11-17", amount: "$12.50", purpose: "Snacks", categoryId: "c1", reason: "Lost it", chargeId: "ch1" });
    expect(m.lib.createNoReceipt).toHaveBeenCalledWith(
      expect.anything(),
      { merchant: "Co-op", purchasedAt: "2026-11-17", totalCents: 1250, purpose: "Snacks", categoryId: "c1", paidWith: null, cardId: null },
      "Lost it",
      "ch1",
    );
    expect(await body(r)).toEqual({ ok: true, expenseId: "e2" });
  });
  it("rejects a bad amount or date before calling the library", async () => {
    expect((await post({ intent: "create-no-receipt", amount: "abc", reason: "x" })).status).toBe(400);
    expect((await post({ intent: "create-no-receipt", purchasedAt: "yesterday", reason: "x" })).status).toBe(400);
    expect(m.lib.createNoReceipt).not.toHaveBeenCalled();
  });
  it("surfaces a missing reason from the library", async () => {
    m.lib.createNoReceipt.mockRejectedValue(new ExpenseError("invalid", "Say why there is no receipt."));
    expect((await post({ intent: "create-no-receipt" })).status).toBe(400);
  });
});

describe("edit, submit and decide", () => {
  it("saves a patch", async () => {
    const r = await post({ intent: "save", id: "e1", patch: JSON.stringify({ merchant: "Copy", amount: "36.87", purchasedAt: "2026-11-17", categoryId: "c1", paidWith: "STAFF_CARD", cardId: "k1" }) });
    expect(m.lib.updateExpense).toHaveBeenCalledWith(expect.anything(), "e1", {
      merchant: "Copy", totalCents: 3687, purchasedAt: "2026-11-17", categoryId: "c1", paidWith: "STAFF_CARD", cardId: "k1",
    });
    expect(r.status).toBe(200);
  });
  it("skips the update for an empty patch", async () => {
    await post({ intent: "save", id: "e1", patch: "{}" });
    expect(m.lib.updateExpense).not.toHaveBeenCalled();
  });
  it("rejects an invalid patch", async () => {
    expect((await post({ intent: "save", id: "e1", patch: '{"amount":"abc"}' })).status).toBe(400);
    expect((await post({ intent: "save", id: "e1", patch: '{"purchasedAt":"soon"}' })).status).toBe(400);
    expect((await post({ intent: "save", id: "e1", patch: '{"paidWith":"CASH"}' })).status).toBe(400);
    expect(m.lib.updateExpense).not.toHaveBeenCalled();
  });
  it("needs an id", async () => {
    expect((await post({ intent: "submit" })).status).toBe(400);
  });
  it("saves edits, then submits", async () => {
    const order: string[] = [];
    m.lib.updateExpense.mockImplementation(async () => void order.push("update"));
    m.lib.submitExpense.mockImplementation(async () => {
      order.push("submit");
      return { paidWith: "OWN_CARD" };
    });
    await post({ intent: "submit", id: "e1", patch: '{"purpose":"Posters"}' });
    expect(order).toEqual(["update", "submit"]);
  });
  it("reports submit blockers from the library", async () => {
    m.lib.submitExpense.mockRejectedValue(new ExpenseError("incomplete", "Pick a category."));
    const r = await post({ intent: "submit", id: "e1" });
    expect(r.status).toBe(400);
    expect((await body(r)).error).toBe("Pick a category.");
  });
  it("withdraws, deletes and marks paid", async () => {
    await post({ intent: "withdraw", id: "e1" });
    await post({ intent: "delete", id: "e1" });
    await post({ intent: "mark-paid", id: "e1" });
    expect(m.lib.withdrawExpense).toHaveBeenCalledWith(expect.anything(), "e1");
    expect(m.lib.deleteDraft).toHaveBeenCalledWith(expect.anything(), "e1");
    expect(m.lib.markPaid).toHaveBeenCalledWith(expect.anything(), "e1");
  });
  it("approves after the approver's category edit", async () => {
    await post({ intent: "decide", id: "e1", decision: "approve", patch: '{"categoryId":"c2"}' });
    expect(m.lib.updateExpense).toHaveBeenCalledWith(expect.anything(), "e1", { categoryId: "c2" });
    expect(m.lib.decideExpense).toHaveBeenCalledWith(expect.anything(), "e1", { decision: "approve", note: "" });
  });
  it("returns with a note", async () => {
    await post({ intent: "decide", id: "e1", decision: "return", note: " Add the invoice " });
    expect(m.lib.decideExpense).toHaveBeenCalledWith(expect.anything(), "e1", { decision: "return", note: "Add the invoice" });
  });
  it.each([
    ["OWN_CARD", "Submitted for approval.", "Approved."],
    ["STAFF_CARD", "Submitted for review.", "Marked reviewed."],
  ] as const)("words the toasts for a %s expense", async (paidWith, submitted, decided) => {
    m.lib.submitExpense.mockResolvedValue({ paidWith });
    m.lib.decideExpense.mockResolvedValue({ paidWith });
    expect((await body(await post({ intent: "submit", id: "e1" }))).message).toBe(submitted);
    expect((await body(await post({ intent: "decide", id: "e1", decision: "approve" }))).message).toBe(decided);
    expect((await body(await post({ intent: "decide", id: "e1", decision: "return", note: "Fix it" }))).message).toBe("Returned with your note.");
  });
  it("rejects an unknown decision", async () => {
    expect((await post({ intent: "decide", id: "e1", decision: "maybe" })).status).toBe(400);
    expect(m.lib.decideExpense).not.toHaveBeenCalled();
  });
});

describe("cards, categories and statements", () => {
  it("adds and edits a card", async () => {
    const fields = { nickname: "Visa", last4: "1234", ownerId: "o", holderIds: '["a","b"]', defaultCategoryId: "" };
    await post({ intent: "card-save", ...fields });
    expect(m.lib.createCard).toHaveBeenCalledWith(expect.anything(), {
      nickname: "Visa",
      last4: "1234",
      ownerId: "o",
      holderIds: ["a", "b"],
      holderGroupIds: [],
      defaultCategoryId: null,
    });
    await post({ intent: "card-save", id: "k1", ...fields });
    expect(m.lib.updateCard).toHaveBeenCalledWith(expect.anything(), "k1", expect.objectContaining({ nickname: "Visa" }));
  });
  it("rejects a non-Core card change with the library's 403", async () => {
    m.lib.createCard.mockRejectedValue(new ExpenseError("forbidden", "Only Core can change cards and categories."));
    expect((await post({ intent: "card-save", nickname: "x", last4: "1", ownerId: "o" })).status).toBe(403);
  });
  it("asks for confirmation before archiving a card with submitted expenses", async () => {
    m.lib.archiveCard.mockResolvedValue({ archived: false, needsConfirm: true, submittedCount: 3 });
    const r = await post({ intent: "card-archive", id: "k1" });
    expect(r.status).toBe(409);
    expect(await body(r)).toMatchObject({ ok: false, needsConfirm: { submittedCount: 3 } });
    m.lib.archiveCard.mockResolvedValue({ archived: true });
    expect(await body(await post({ intent: "card-archive", id: "k1", confirm: "1" }))).toMatchObject({ ok: true, archived: true });
    expect(m.lib.archiveCard).toHaveBeenLastCalledWith(expect.anything(), "k1", { confirm: true });
  });
  it("saves and archives categories", async () => {
    await post({ intent: "category-save", label: "Technigala", chartString: "", hints: "poster, Technigala ,," });
    expect(m.lib.createCategory).toHaveBeenCalledWith(expect.anything(), { label: "Technigala", chartString: null, hints: ["poster", "Technigala"] });
    await post({ intent: "category-save", id: "c1", label: "T" });
    expect(m.lib.updateCategory).toHaveBeenCalledWith(expect.anything(), "c1", expect.objectContaining({ label: "T" }));
    await post({ intent: "category-archive", id: "c1" });
    expect(m.lib.archiveCategory).toHaveBeenCalledWith(expect.anything(), "c1");
  });
  it("imports a statement with the chosen columns and returns the counts", async () => {
    const summary = { imported: 4, skipped: 1, matched: 2, needsReceipt: 2, notOnStatement: 0, ambiguous: 0, errors: [] };
    m.lib.importStatement.mockResolvedValue(summary);
    const r = await post({ intent: "import-statement", cardId: "k1", csv: "D,M,A\n1,2,3", date: "D", merchant: "M", amount: "A", invertSign: "1" });
    expect(m.lib.importStatement).toHaveBeenCalledWith(expect.anything(), "k1", "D,M,A\n1,2,3", { date: "D", merchant: "M", amount: "A", invertSign: true });
    expect(await body(r)).toEqual({ ok: true, summary });
  });
  it("reports an import the library refuses", async () => {
    m.lib.importStatement.mockRejectedValue(new ExpenseError("forbidden", "Only the card owner or Core can import a statement."));
    expect((await post({ intent: "import-statement", cardId: "k1", csv: "x" })).status).toBe(403);
  });
  it("matches and unmatches a charge", async () => {
    await post({ intent: "match-charge", expenseId: "e1", chargeId: "ch1" });
    await post({ intent: "unmatch-charge", expenseId: "e1" });
    expect(m.lib.matchCharge).toHaveBeenCalledWith(expect.anything(), "e1", "ch1");
    expect(m.lib.unmatchCharge).toHaveBeenCalledWith(expect.anything(), "e1");
  });
  it("asks card holders for a receipt, and says when it was already sent", async () => {
    m.requestReceipt.mockResolvedValueOnce({ notified: 2 }).mockResolvedValueOnce({ notified: 0 });
    expect((await body(await post({ intent: "request-receipt", chargeId: "ch1" }))).message).toBe("Card holders were asked for a receipt.");
    expect((await body(await post({ intent: "request-receipt", chargeId: "ch1" }))).message).toBe("Card holders were asked recently.");
  });
});

describe("toUpdateInput", () => {
  it("clears fields sent as null or empty", () => {
    expect(toUpdateInput({ amount: "", purchasedAt: null, categoryId: "", cardId: null })).toEqual({
      totalCents: null, purchasedAt: null, categoryId: null, cardId: null,
    });
  });
  it("ignores keys it doesn't know", () => {
    expect(toUpdateInput({ status: "APPROVED", submitterId: "x" })).toEqual({});
  });
});
