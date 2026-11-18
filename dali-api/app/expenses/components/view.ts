import type { ExpenseDetail, ExpenseExtractionJson, listExpenses } from "../lib/expenses.server";
import type { ExtractedReceipt } from "../lib/extract.server";
import { expenseLineItems } from "../lib/line-items";
import { cardLabel } from "./format";
import type { ExpenseRow, ExpenseView } from "./types";

type ListRow = Awaited<ReturnType<typeof listExpenses>>[number];

const day = (d: Date | string | null | undefined) => (d ? (d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
const person = (p: { firstName: string; lastName: string } | null | undefined) =>
  p ? `${p.firstName} ${p.lastName}`.trim() : "";

export const LOW_CONFIDENCE = 0.6;

const FIELD_KEYS = {
  merchant: ["merchant"],
  date: ["date", "purchasedAt"],
  total: ["total", "amountCharged"],
} as const;

function uncertainFields(receipts: { kind: string; extracted: unknown }[]): ExpenseView["uncertain"] {
  const primary = receipts.find((r) => r.kind === "PAYMENT_PROOF") ?? receipts[0];
  const confidence = ((primary?.extracted ?? {}) as Partial<ExtractedReceipt>).confidence ?? {};
  return (Object.keys(FIELD_KEYS) as (keyof typeof FIELD_KEYS)[]).filter((field) =>
    FIELD_KEYS[field].some((k) => typeof confidence[k] === "number" && confidence[k] < LOW_CONFIDENCE),
  );
}

export function toExpenseView(d: ExpenseDetail): ExpenseView {
  const x = (d.extraction ?? {}) as Partial<ExpenseExtractionJson>;
  return {
    id: d.id,
    status: d.status,
    paidWith: d.paidWith,
    cardId: d.cardId,
    cardArchived: Boolean(d.card?.archivedAt),
    cardOwnerId: d.card?.ownerId ?? null,
    cardLabel: d.card ? cardLabel(d.card) : null,
    merchant: d.merchant,
    purchasedAt: day(d.purchasedAt),
    totalCents: d.totalCents,
    purpose: d.purpose,
    categoryId: d.categoryId,
    noReceipt: d.noReceipt,
    noReceiptReason: d.noReceiptReason,
    decisionNote: d.decisionNote,
    submitterId: d.submitterId,
    submitterName: person(d.submitter),
    approverName: person(d.approver) || null,
    matched: d.matched,
    charge: d.statementCharge
      ? { merchant: d.statementCharge.merchant, postedAt: day(d.statementCharge.postedAt) ?? "", amountCents: d.statementCharge.amountCents }
      : null,
    receipts: d.receipts.map((r) => ({ id: r.id, kind: r.kind, contentType: r.contentType, url: r.url })),
    lineItems: expenseLineItems(d.receipts),
    checks: d.checks,
    suggestion: d.suggestion,
    extractionError: x.extractionError ?? null,
    uncertain: uncertainFields(d.receipts),
    chargeId: x.chargeId ?? null,
  };
}

export function toExpenseRow(r: ListRow): ExpenseRow {
  return {
    id: r.id,
    merchant: r.merchant,
    purpose: r.purpose,
    status: r.status,
    paidWith: r.paidWith,
    cardId: r.cardId,
    cardLabel: r.card ? cardLabel(r.card) : null,
    categoryLabel: r.category?.label ?? null,
    totalCents: r.totalCents,
    purchasedAt: day(r.purchasedAt),
    noReceipt: r.noReceipt,
    matched: r.matched,
    submitterId: r.submitterId,
    submitterName: person(r.submitter),
    receiptCount: r.receipts.length,
  };
}
