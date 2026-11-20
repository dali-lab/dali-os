import type { Prisma } from "~/generated/prisma/client";
import { auditExpense } from "./audit.server";
import { prisma } from "~/lib/db.server";
import { canImportStatement, canViewCard, type ExpenseViewer } from "./access";
import { ExpenseError } from "./errors";
import { findRefundOriginal, matchCharges, type MatchCharge, type MatchExpense } from "./matching";
import { centsToDecimalString, parseMoneyToCents } from "./money";
import type { StatementMapping } from "./statement-csv";
import { parseStatementWithFingerprints } from "./statement-csv.server";

export type ImportSummary = {
  imported: number;
  skipped: number;
  matched: number;
  needsReceipt: number;
  notOnStatement: number;
  ambiguous: number;
  errors: { line: number; message: string }[];
};

const cents = (v: { toString(): string }) => parseMoneyToCents(v.toString()) ?? 0;

async function assertCard(cardId: string): Promise<void> {
  const card = await prisma.expenseCard.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) throw new ExpenseError("not_found", "Card not found.");
}

function toMatchExpense(e: {
  id: string;
  cardId: string | null;
  merchant: string | null;
  purchasedAt: Date | null;
  total: { toString(): string } | null;
  extraction: unknown;
}): MatchExpense | null {
  if (!e.cardId || !e.purchasedAt || e.total === null) return null;
  const amounts = ((e.extraction ?? {}) as { amounts?: { subtotalCents?: number | null; taxCents?: number | null; tipCents?: number | null } }).amounts;
  return {
    id: e.id,
    cardId: e.cardId,
    merchant: e.merchant ?? "",
    purchasedAt: e.purchasedAt,
    totalCents: cents(e.total),
    subtotalCents: amounts?.subtotalCents ?? null,
    taxCents: amounts?.taxCents ?? null,
    tipCents: amounts?.tipCents ?? null,
  };
}

export async function runAutoMatch(cardId: string) {
  const [chargeRows, expenseRows] = await Promise.all([
    prisma.cardStatementCharge.findMany({ where: { cardId, expense: { is: null } } }),
    prisma.expense.findMany({
      where: { cardId, paidWith: "STAFF_CARD", status: "APPROVED", statementChargeId: null },
      select: { id: true, cardId: true, merchant: true, purchasedAt: true, total: true, extraction: true },
    }),
  ]);
  const charges: MatchCharge[] = chargeRows.map((c) => ({
    id: c.id,
    cardId: c.cardId,
    merchant: c.merchant,
    postedAt: c.postedAt,
    amountCents: cents(c.amount),
  }));
  const expenses = expenseRows.map(toMatchExpense).filter((e): e is MatchExpense => e !== null);
  const outcome = matchCharges(charges, expenses);

  let matched = 0;
  const linked = new Set<string>();
  for (const m of outcome.matches) {
    try {
      const r = await prisma.expense.updateMany({
        where: { id: m.expenseId, status: "APPROVED", statementChargeId: null },
        data: { statementChargeId: m.chargeId },
      });
      if (r.count === 1) {
        matched++;
        linked.add(m.chargeId);
      }
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  const ambiguousChargeIds = new Set(outcome.ambiguousCharges.map((a) => a.chargeId));
  return {
    matched,
    needsReceipt: outcome.unmatchedChargeIds.filter((id) => !linked.has(id)).length,
    notOnStatement: outcome.unmatchedExpenseIds.length + expenseRows.length - expenses.length,
    ambiguous: ambiguousChargeIds.size + outcome.ambiguousExpenses.length,
  };
}

export async function importStatement(
  actor: ExpenseViewer,
  cardId: string,
  csvText: string,
  mapping: StatementMapping,
): Promise<ImportSummary> {
  if (!canImportStatement(actor, cardId)) throw new ExpenseError("forbidden", "Only the card owner or Core can import a statement.");
  await assertCard(cardId);

  const parsed = parseStatementWithFingerprints(csvText, mapping);
  if (parsed.rows.length === 0) {
    throw new ExpenseError("invalid", parsed.errors[0]?.message ?? "No charges found in that file.");
  }

  const existing = await prisma.cardStatementCharge.findMany({
    where: { cardId, fingerprint: { in: parsed.rows.map((r) => r.fingerprint) } },
    select: { fingerprint: true },
  });
  const known = new Set(existing.map((e) => e.fingerprint));
  const fresh = parsed.rows.filter((r) => !known.has(r.fingerprint));

  const created = await prisma.cardStatementCharge.createManyAndReturn({
    data: fresh.map((r) => ({
      cardId,
      postedAt: r.postedAt,
      merchant: r.merchant,
      amount: centsToDecimalString(r.amountCents),
      fingerprint: r.fingerprint,
      rawRow: r.rawRow as Prisma.InputJsonValue,
      importedById: actor.userId,
    })),
    skipDuplicates: true,
  });

  const refunds = created.filter((c) => cents(c.amount) < 0);
  if (refunds.length > 0) {
    const originals = await prisma.cardStatementCharge.findMany({
      where: { cardId, amount: { in: refunds.map((r) => centsToDecimalString(-cents(r.amount))) } },
    });
    const pool: MatchCharge[] = originals.map((c) => ({ id: c.id, cardId, merchant: c.merchant, postedAt: c.postedAt, amountCents: cents(c.amount) }));
    for (const refund of refunds) {
      const originalId = findRefundOriginal(
        { id: refund.id, cardId, merchant: refund.merchant, postedAt: refund.postedAt, amountCents: cents(refund.amount) },
        pool,
      );
      if (originalId) await prisma.cardStatementCharge.update({ where: { id: refund.id }, data: { refundOfChargeId: originalId } });
    }
  }

  const match = await runAutoMatch(cardId);
  await auditExpense(actor, "expense.statement.import", cardId, { imported: created.length, skipped: parsed.rows.length - created.length });
  return {
    imported: created.length,
    skipped: parsed.rows.length - created.length,
    errors: parsed.errors,
    ...match,
  };
}

export type ChargeState = "matched" | "needs_receipt" | "refund";

export async function listCharges(
  actor: ExpenseViewer,
  cardId: string,
  opts: { state?: ChargeState; limit?: number } = {},
) {
  if (!canViewCard(actor, cardId)) throw new ExpenseError("forbidden", "Only the card owner or Core can see a card's charges.");
  const rows = await prisma.cardStatementCharge.findMany({
    where: { cardId },
    include: { expense: { select: { id: true, merchant: true, submitterId: true, status: true } } },
    orderBy: { postedAt: "desc" },
    take: Math.min(opts.limit ?? 500, 1000),
  });
  const charges = rows.map(({ amount, rawRow: _raw, ...c }) => {
    const amountCents = cents(amount);
    const state: ChargeState = amountCents < 0 ? "refund" : c.expense ? "matched" : "needs_receipt";
    return { ...c, amountCents, state };
  });
  return opts.state ? charges.filter((c) => c.state === opts.state) : charges;
}
