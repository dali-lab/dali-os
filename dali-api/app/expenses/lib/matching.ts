export type MatchExpense = {
  id: string;
  cardId: string;
  merchant: string;
  purchasedAt: Date;
  totalCents: number;
  subtotalCents?: number | null;
  taxCents?: number | null;
  tipCents?: number | null;
};

export type MatchCharge = {
  id: string;
  cardId: string;
  merchant: string;
  postedAt: Date;
  amountCents: number;
};

export type MatchSignals = { amount: boolean; date: boolean; merchant: boolean };

export type StatementMatch = { chargeId: string; expenseId: string; signals: MatchSignals };

export type MatchOutcome = {
  matches: StatementMatch[];
  ambiguousCharges: { chargeId: string; expenseIds: string[] }[];
  ambiguousExpenses: { expenseId: string; chargeIds: string[] }[];
  unmatchedChargeIds: string[];
  unmatchedExpenseIds: string[];
};

export const DATE_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;

export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function merchantsAgree(a: string, b: string): boolean {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

function dayNumber(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

export function datesAgree(a: Date, b: Date): boolean {
  return Math.abs(dayNumber(a) - dayNumber(b)) <= DATE_WINDOW_DAYS;
}

export function amountsAgree(expense: MatchExpense, chargeCents: number): boolean {
  if (chargeCents === expense.totalCents) return true;
  const hasTip = (expense.tipCents ?? 0) > 0;
  if (!hasTip || expense.subtotalCents === null || expense.subtotalCents === undefined) return false;
  const floor = expense.subtotalCents + (expense.taxCents ?? 0);
  return chargeCents >= floor && chargeCents <= expense.totalCents;
}

export function matchSignals(expense: MatchExpense, charge: MatchCharge): MatchSignals {
  return {
    amount: amountsAgree(expense, charge.amountCents),
    date: datesAgree(expense.purchasedAt, charge.postedAt),
    merchant: merchantsAgree(expense.merchant, charge.merchant),
  };
}

export function signalLabel(s: MatchSignals): string {
  const parts = [s.amount && "amount", s.date && "date", s.merchant && "merchant"].filter(Boolean) as string[];
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function qualifies(s: MatchSignals): boolean {
  return (s.amount && (s.date || s.merchant)) || (s.date && s.merchant);
}

export function matchCharges(charges: MatchCharge[], expenses: MatchExpense[]): MatchOutcome {
  const eligible = charges.filter((c) => c.amountCents > 0);
  const byCharge = new Map<string, { expenseId: string; signals: MatchSignals }[]>();
  const byExpense = new Map<string, { chargeId: string; signals: MatchSignals }[]>();

  for (const c of eligible) {
    for (const e of expenses) {
      if (e.cardId !== c.cardId) continue;
      const signals = matchSignals(e, c);
      if (!qualifies(signals)) continue;
      byCharge.set(c.id, [...(byCharge.get(c.id) ?? []), { expenseId: e.id, signals }]);
      byExpense.set(e.id, [...(byExpense.get(e.id) ?? []), { chargeId: c.id, signals }]);
    }
  }

  const matches: StatementMatch[] = [];
  const ambiguousCharges: MatchOutcome["ambiguousCharges"] = [];
  const ambiguousExpenses: MatchOutcome["ambiguousExpenses"] = [];
  const matchedCharges = new Set<string>();
  const matchedExpenses = new Set<string>();

  for (const [chargeId, candidates] of byCharge) {
    if (candidates.length > 1) {
      ambiguousCharges.push({ chargeId, expenseIds: candidates.map((x) => x.expenseId) });
      continue;
    }
    const [only] = candidates;
    if ((byExpense.get(only.expenseId) ?? []).length !== 1) continue;
    matches.push({ chargeId, expenseId: only.expenseId, signals: only.signals });
    matchedCharges.add(chargeId);
    matchedExpenses.add(only.expenseId);
  }
  for (const [expenseId, candidates] of byExpense) {
    if (candidates.length > 1) ambiguousExpenses.push({ expenseId, chargeIds: candidates.map((x) => x.chargeId) });
  }

  return {
    matches,
    ambiguousCharges,
    ambiguousExpenses,
    unmatchedChargeIds: eligible.filter((c) => !matchedCharges.has(c.id)).map((c) => c.id),
    unmatchedExpenseIds: expenses.filter((e) => !matchedExpenses.has(e.id)).map((e) => e.id),
  };
}

export function findRefundOriginal(refund: MatchCharge, charges: MatchCharge[]): string | null {
  if (refund.amountCents >= 0) return null;
  const candidates = charges
    .filter(
      (c) =>
        c.id !== refund.id &&
        c.cardId === refund.cardId &&
        c.amountCents === -refund.amountCents &&
        c.postedAt.getTime() <= refund.postedAt.getTime() &&
        merchantsAgree(c.merchant, refund.merchant),
    )
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  return candidates[0]?.id ?? null;
}
