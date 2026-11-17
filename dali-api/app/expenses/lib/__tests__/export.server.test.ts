import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listExpenses: vi.fn(),
  render: vi.fn(),
  getObjectBytes: vi.fn(),
  getDownloadUrl: vi.fn(),
  prisma: { expenseReceipt: { findMany: vi.fn() } },
}));
vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));
vi.mock("../expenses.server", () => ({ listExpenses: m.listExpenses }));
vi.mock("~/lib/pdf/render.server", () => ({ renderHtmlToPdf: m.render }));
vi.mock("~/lib/s3.server", () => ({ getObjectBytes: m.getObjectBytes, getDownloadUrl: m.getDownloadUrl }));

import type { ExpenseViewer } from "../access";
import { ExpenseError } from "../errors";
import { exportExpensesCsv, exportExpensesPdf, MAX_PDF_EXPENSES } from "../export.server";

const viewer: ExpenseViewer = { userId: "u", isCore: true, isStaff: true, ownedCardIds: [] };

const row = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "APPROVED",
  submitter: { firstName: "Ada", lastName: "Lovelace" },
  submittedAt: new Date("2026-11-02T10:00:00Z"),
  createdAt: new Date("2026-11-01T10:00:00Z"),
  merchant: 'Acme, "Co"',
  purchasedAt: new Date("2026-11-01T00:00:00Z"),
  totalCents: 3687,
  paidWith: "STAFF_CARD",
  card: { nickname: "Social", last4: "4242" },
  category: { label: "Food" },
  chartString: "1-2-3",
  purpose: "Line one\nline two",
  noReceipt: false,
  noReceiptReason: null,
  approver: { firstName: "Grace", lastName: "Hopper" },
  decidedAt: new Date("2026-11-03T00:00:00Z"),
  paidAt: null,
  statementCharge: { postedAt: new Date("2026-11-02T00:00:00Z"), merchant: "ACME" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.render.mockResolvedValue(Buffer.from("pdf"));
  m.prisma.expenseReceipt.findMany.mockResolvedValue([]);
});

describe("exportExpensesCsv", () => {
  it("writes the header and escaped rows through listExpenses", async () => {
    m.listExpenses.mockResolvedValue([row()]);
    const csv = await exportExpensesCsv(viewer, "all", { cardId: "c1" });
    const [header, line] = csv.split("\r\n");
    expect(header).toBe(
      "id,status,filed by,filed at,merchant,purchase date,amount,paid with,card,category,chart string,purpose,no receipt,no-receipt reason,approver,decided at,paid at,matched charge",
    );
    expect(line).toContain('"Acme, ""Co"""');
    expect(line).toContain('"Line one\nline two"');
    expect(line).toContain("Ada Lovelace");
    expect(line).toContain("36.87");
    expect(line).toContain("Social ··4242");
    expect(line).toContain("2026-11-02 ACME");
    expect(m.listExpenses).toHaveBeenCalledWith(viewer, "all", expect.objectContaining({ cardId: "c1" }));
  });

  it("leaves nullable columns empty", async () => {
    m.listExpenses.mockResolvedValue([row({ totalCents: null, paidWith: null, card: null, category: null, approver: null, statementCharge: null, noReceipt: true, noReceiptReason: "Lost" })]);
    const line = (await exportExpensesCsv(viewer, "mine")).split("\r\n")[1];
    expect(line).toContain(",yes,Lost,");
    expect(line.endsWith(",,")).toBe(true);
  });

  it("pages through large result sets", async () => {
    m.listExpenses
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => row({ id: `a${i}` })))
      .mockResolvedValueOnce([row({ id: "last" })]);
    const csv = await exportExpensesCsv(viewer, "all");
    expect(csv.trim().split("\r\n")).toHaveLength(502);
    expect(m.listExpenses.mock.calls[1][2]).toMatchObject({ offset: 500 });
  });

  it("propagates access errors", async () => {
    m.listExpenses.mockRejectedValue(new ExpenseError("forbidden", "no"));
    await expect(exportExpensesCsv(viewer, "all")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("exportExpensesPdf", () => {
  it("renders a summary per expense with image receipts as data URIs and PDFs as notes", async () => {
    m.listExpenses.mockResolvedValue([row({ id: "e1" }), row({ id: "e2", merchant: "<b>x</b>" })]);
    m.prisma.expenseReceipt.findMany.mockResolvedValue([
      { expenseId: "e1", s3Key: "k1", contentType: "image/png", kind: "ITEMIZED" },
      { expenseId: "e1", s3Key: "k2", contentType: "application/pdf", kind: "OTHER" },
    ]);
    m.getObjectBytes.mockResolvedValue({ body: Buffer.from("img") });
    m.getDownloadUrl.mockResolvedValue("https://s3/x");
    const bytes = await exportExpensesPdf(viewer, "all");
    expect(bytes).toBeInstanceOf(Uint8Array);
    const html = m.render.mock.calls[0][0] as string;
    expect(html.match(/class="expense"/g)).toHaveLength(2);
    expect(html).toContain(`data:image/png;base64,${Buffer.from("img").toString("base64")}`);
    expect(html).toContain("https://s3/x");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(m.render.mock.calls[0][1]).toMatchObject({ guardNetwork: true });
  });

  it("notes a receipt that cannot be loaded instead of failing", async () => {
    m.listExpenses.mockResolvedValue([row()]);
    m.prisma.expenseReceipt.findMany.mockResolvedValue([{ expenseId: "e1", s3Key: "k1", contentType: "image/png", kind: "ITEMIZED" }]);
    m.getObjectBytes.mockRejectedValue(new Error("gone"));
    await exportExpensesPdf(viewer, "all");
    expect(m.render.mock.calls[0][0]).toContain("could not be loaded");
  });

  it("refuses more than the cap and says so", async () => {
    m.listExpenses.mockResolvedValue(Array.from({ length: MAX_PDF_EXPENSES + 1 }, (_, i) => row({ id: `e${i}` })));
    await expect(exportExpensesPdf(viewer, "all")).rejects.toThrow(`up to ${MAX_PDF_EXPENSES}`);
    expect(m.render).not.toHaveBeenCalled();
  });

  it("refuses an empty export", async () => {
    m.listExpenses.mockResolvedValue([]);
    await expect(exportExpensesPdf(viewer, "mine")).rejects.toMatchObject({ code: "invalid" });
  });
});
