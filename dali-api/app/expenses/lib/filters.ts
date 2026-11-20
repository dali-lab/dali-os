import type { ExpenseFilters, ExpenseScope } from "./expenses.server";
import type { ExpenseStatusValue } from "./status";

const STATUSES: ExpenseStatusValue[] = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "PAID"];
const SCOPES: ExpenseScope[] = ["mine", "approvals", "all"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseScope(raw: string | null): ExpenseScope {
  return SCOPES.includes(raw as ExpenseScope) ? (raw as ExpenseScope) : "mine";
}

function parseDay(raw: string | null): Date | undefined {
  if (!raw || !DAY.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseExpenseFilters(params: URLSearchParams): ExpenseFilters {
  const status = (params.get("status") ?? "")
    .split(",")
    .filter((s): s is ExpenseStatusValue => STATUSES.includes(s as ExpenseStatusValue));
  const filters: ExpenseFilters = {};
  if (status.length) filters.status = status;
  const cardId = params.get("cardId");
  if (cardId) filters.cardId = cardId;
  const categoryId = params.get("categoryId");
  if (categoryId) filters.categoryId = categoryId;
  const termId = params.get("termId");
  if (termId) filters.termId = termId;
  const from = parseDay(params.get("from"));
  if (from) filters.from = from;
  const to = parseDay(params.get("to"));
  if (to) filters.to = to;
  if (params.get("noReceipt") === "1") filters.noReceipt = true;
  if (params.get("outstanding") === "1") filters.outstanding = true;
  return filters;
}

export const FILTER_KEYS = ["status", "cardId", "categoryId", "termId", "from", "to", "noReceipt", "outstanding"] as const;
