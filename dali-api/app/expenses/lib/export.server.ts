import { prisma } from "~/lib/db.server";
import { rowsToCsv } from "~/lib/csv";
import { renderHtmlToPdf } from "~/lib/pdf/render.server";
import { getDownloadUrl, getObjectBytes } from "~/lib/s3.server";
import type { ExpenseViewer } from "./access";
import { ExpenseError } from "./errors";
import { listExpenses, type ExpenseFilters, type ExpenseScope } from "./expenses.server";
import { centsToDecimalString } from "./money";

export const MAX_CSV_EXPENSES = 5000;
export const MAX_PDF_EXPENSES = 40;
const PAGE_SIZE = 500;
const LINK_TTL_SECONDS = 86_400;

type Row = Awaited<ReturnType<typeof listExpenses>>[number];

export const CSV_HEADERS = [
  "id",
  "status",
  "filed by",
  "filed at",
  "merchant",
  "purchase date",
  "amount",
  "paid with",
  "card",
  "category",
  "chart string",
  "purpose",
  "no receipt",
  "no-receipt reason",
  "approver",
  "decided at",
  "paid at",
  "matched charge",
] as const;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const stamp = (d: Date | null | undefined) => (d ? d.toISOString() : "");
const personName = (p: { firstName: string; lastName: string } | null | undefined) => (p ? `${p.firstName} ${p.lastName}`.trim() : "");
const cardLabel = (c: { nickname: string; last4: string } | null | undefined) => (c ? `${c.nickname} ··${c.last4}` : "");
const PAID_WITH: Record<string, string> = { STAFF_CARD: "Staff card", OWN_CARD: "Own card" };

function chargeLabel(e: Row): string {
  const c = e.statementCharge;
  return c ? `${day(c.postedAt)} ${c.merchant}`.trim() : "";
}

function csvRow(e: Row): unknown[] {
  return [
    e.id,
    e.status,
    personName(e.submitter),
    stamp(e.submittedAt ?? e.createdAt),
    e.merchant ?? "",
    day(e.purchasedAt),
    e.totalCents === null ? "" : centsToDecimalString(e.totalCents),
    e.paidWith ? PAID_WITH[e.paidWith] : "",
    cardLabel(e.card),
    e.category?.label ?? "",
    e.chartString ?? "",
    e.purpose ?? "",
    e.noReceipt ? "yes" : "no",
    e.noReceiptReason ?? "",
    personName(e.approver),
    stamp(e.decidedAt),
    stamp(e.paidAt),
    chargeLabel(e),
  ];
}

async function collect(actor: ExpenseViewer, scope: ExpenseScope, filters: ExpenseFilters, max: number): Promise<Row[]> {
  const out: Row[] = [];
  const start = filters.offset ?? 0;
  while (out.length < max) {
    const limit = Math.min(PAGE_SIZE, max - out.length + 1);
    const page = await listExpenses(actor, scope, { ...filters, limit, offset: start + out.length });
    out.push(...page);
    if (page.length < limit) break;
  }
  return out;
}

export async function exportExpensesCsv(actor: ExpenseViewer, scope: ExpenseScope, filters: ExpenseFilters = {}): Promise<string> {
  const rows = await collect(actor, scope, filters, MAX_CSV_EXPENSES);
  if (rows.length > MAX_CSV_EXPENSES) {
    throw new ExpenseError("invalid", `Exports are limited to ${MAX_CSV_EXPENSES} expenses. Narrow the filters and try again.`);
  }
  return rowsToCsv([[...CSV_HEADERS], ...rows.map(csvRow)]);
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const PRINT_CSS = `
  @page { size: Letter; margin: 0.7in; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #13293a; font-size: 13px; }
  .expense { break-after: page; }
  .expense:last-child { break-after: auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #5b6b78; margin: 0 0 16px; }
  dl { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; margin: 0; }
  dt { color: #5b6b78; }
  dd { margin: 0; }
  .receipt { break-before: page; text-align: center; }
  .receipt img { max-width: 100%; max-height: 9in; object-fit: contain; }
  .note { color: #5b6b78; }
`;

type ReceiptRow = { expenseId: string; s3Key: string; contentType: string; kind: string };

async function receiptHtml(r: ReceiptRow, index: number): Promise<string> {
  const label = `Receipt ${index + 1}`;
  if (r.contentType === "application/pdf") {
    const url = await getDownloadUrl(r.s3Key, { expiresIn: LINK_TTL_SECONDS, contentType: r.contentType }).catch(() => null);
    const link = url ? ` <a href="${esc(url)}">Open the PDF</a> (link expires in 24 hours).` : "";
    return `<section class="receipt"><p class="note">${label}: PDF receipt, not embedded.${link}</p></section>`;
  }
  try {
    const { body } = await getObjectBytes(r.s3Key);
    return `<section class="receipt"><img src="data:${esc(r.contentType)};base64,${body.toString("base64")}" alt="${label}" /></section>`;
  } catch {
    return `<section class="receipt"><p class="note">${label}: could not be loaded.</p></section>`;
  }
}

function summaryHtml(e: Row): string {
  const amount = e.totalCents === null ? "" : `$${centsToDecimalString(e.totalCents)}`;
  const fields: [string, string][] = [
    ["Status", e.status],
    ["Filed by", personName(e.submitter)],
    ["Purchase date", day(e.purchasedAt)],
    ["Amount", amount],
    ["Paid with", [e.paidWith ? PAID_WITH[e.paidWith] : "", cardLabel(e.card)].filter(Boolean).join(", ")],
    ["Category", e.category?.label ?? ""],
    ["Chart string", e.chartString ?? ""],
    ["Purpose", e.purpose ?? ""],
    ["Receipt", e.noReceipt ? `None. ${e.noReceiptReason ?? ""}`.trim() : ""],
    ["Approver", personName(e.approver)],
    ["Decided", day(e.decidedAt)],
    ["Paid", day(e.paidAt)],
    ["Matched charge", chargeLabel(e)],
  ];
  const items = fields.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`);
  return `<h1>${esc(e.merchant ?? "Expense")}</h1><p class="sub">${esc(e.id)}</p><dl>${items.join("")}</dl>`;
}

export async function exportExpensesPdf(actor: ExpenseViewer, scope: ExpenseScope, filters: ExpenseFilters = {}): Promise<Uint8Array> {
  const rows = await collect(actor, scope, filters, MAX_PDF_EXPENSES);
  if (rows.length > MAX_PDF_EXPENSES) {
    throw new ExpenseError("invalid", `A PDF can hold up to ${MAX_PDF_EXPENSES} expenses. Narrow the filters and try again.`);
  }
  if (rows.length === 0) throw new ExpenseError("invalid", "There are no expenses to export.");

  const receipts = await prisma.expenseReceipt.findMany({
    where: { expenseId: { in: rows.map((r) => r.id) } },
    orderBy: { createdAt: "asc" },
    select: { expenseId: true, s3Key: true, contentType: true, kind: true },
  });
  const byExpense = new Map<string, ReceiptRow[]>();
  for (const r of receipts) byExpense.set(r.expenseId, [...(byExpense.get(r.expenseId) ?? []), r]);

  const sections: string[] = [];
  for (const e of rows) {
    const parts = await Promise.all((byExpense.get(e.id) ?? []).map(receiptHtml));
    sections.push(`<div class="expense">${summaryHtml(e)}${parts.join("")}</div>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${sections.join("")}</body></html>`;
  return new Uint8Array(await renderHtmlToPdf(html, { guardNetwork: true, hardTimeoutMs: 120_000 }));
}
