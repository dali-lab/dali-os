import { prisma } from "~/lib/db.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { mobileError, requireMobileUser } from "~/lib/mobile-auth.server";
import type { ExpenseViewer } from "./access";
import { ExpenseError } from "./errors";
import { loadExpenseViewer, type ExpenseDetail, type listExpenses } from "./expenses.server";
import { expenseLineItems } from "./line-items";
import { centsToDecimalString } from "./money";
import { ReceiptKeyError } from "./receipts.server";

type ListRow = Awaited<ReturnType<typeof listExpenses>>[number];
type ActiveExpense = ListRow | ExpenseDetail;

export type MobileExpenseGuard = { ok: true; userId: string; viewer: ExpenseViewer } | { ok: false; response: Response };

export async function requireMobileExpenses(request: Request): Promise<MobileExpenseGuard> {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard;
  const roles = await getUserRoles(guard.userId, request);
  if (!(await isFeatureEnabled("expenses", guard.userId, roles, request))) {
    return { ok: false, response: mobileError("Not found", 404) };
  }
  return { ok: true, userId: guard.userId, viewer: await loadExpenseViewer(guard.userId, request) };
}

export function mobileExpenseError(e: unknown): Response {
  if (e instanceof ExpenseError) return mobileError(e.message, e.status);
  if (e instanceof ReceiptKeyError) return mobileError(e.message, 400);
  throw e;
}

const money = (cents: number | null) => (cents === null ? null : centsToDecimalString(cents));

export function toSummary(e: ActiveExpense, receiptCount: number) {
  return {
    id: e.id,
    status: e.status,
    paidWith: e.paidWith,
    card: e.card ? { id: e.card.id, nickname: e.card.nickname, last4: e.card.last4 } : null,
    merchant: e.merchant,
    purpose: e.purpose,
    category: e.category ? { id: e.category.id, label: e.category.label } : null,
    total: money(e.totalCents),
    purchasedAt: e.purchasedAt ? e.purchasedAt.toISOString() : null,
    noReceipt: e.noReceipt,
    matched: e.statementChargeId !== null,
    receiptCount,
  };
}

export function toMobileSummary(e: ListRow) {
  return toSummary(e, e.receipts.length);
}

export function toMobileDetail(e: ExpenseDetail) {
  const lineItems = expenseLineItems(e.receipts).map((l) => ({ description: l.description, amount: money(l.amountCents) }));
  const suggestion = e.suggestion;
  return {
    ...toSummary(e, e.receipts.length),
    lineItems,
    categoryReason: suggestion && suggestion.categoryId === e.categoryId ? suggestion.reason : null,
    checks: e.checks.map((c) => ({ level: c.level === "ok" ? ("ok" as const) : ("warn" as const), message: c.message })),
    receipts: e.receipts.flatMap((r) => (r.url ? [{ id: r.id, kind: r.kind, url: r.url, contentType: r.contentType }] : [])),
    decisionNote: e.status === "RETURNED" ? e.decisionNote : null,
  };
}

export async function mobileOptions(viewer: ExpenseViewer) {
  const userId = viewer.userId;
  const [cards, categories, last] = await Promise.all([
    prisma.expenseCard.findMany({
      where: {
        archivedAt: null,
        OR: [{ ownerId: userId }, { holderIds: { has: userId } }, { holderGroupIds: { hasSome: [...(viewer.groupIds ?? [])] } }],
      },
      select: { id: true, nickname: true, last4: true },
      orderBy: { nickname: "asc" },
    }),
    prisma.expenseCategory.findMany({ where: { archivedAt: null }, select: { id: true, label: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.expense.findFirst({
      where: { submitterId: userId, paidWith: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { paidWith: true, cardId: true },
    }),
  ]);
  return {
    cards,
    categories,
    lastPaidWith: last?.paidWith ? { paidWith: last.paidWith, cardId: last.cardId } : null,
  };
}
