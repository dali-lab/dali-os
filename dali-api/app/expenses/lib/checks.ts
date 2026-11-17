import { formatCents } from "./money";

export type CheckReceipt = {
  kind: "PAYMENT_PROOF" | "ITEMIZED" | "OTHER";
  sha256: string;
  invoiceNumbers: string[];
  totalCents: number | null;
  lineItems?: { description: string; amountCents: number | null }[];
};

export type CheckInput = {
  noReceipt: boolean;
  totalCents: number | null;
  receipts: CheckReceipt[];
  teamMeal: boolean;
  attendeeCount: number;
  others: { expenseId: string; sha256s: string[]; invoiceNumbers: string[] }[];
};

export type CheckCode =
  | "no_receipt_attached"
  | "itemized"
  | "card_slip_only"
  | "totals_match"
  | "totals_mismatch"
  | "unexplained_lines"
  | "duplicate_receipt"
  | "team_meal_attendees";

export type Check = {
  code: CheckCode;
  level: "ok" | "warning";
  message: string;
  expenseIds?: string[];
};

const normInvoice = (n: string) => n.trim().toUpperCase().replace(/^(INV(OICE)?|NO|#)[\s.#:-]*/i, "");

export function unexplainedLines(receipts: CheckReceipt[]): { description: string; amountCents: number | null }[] {
  const itemized = receipts.filter((r) => r.kind === "ITEMIZED");
  if (itemized.length === 0) return [];
  const totals = new Set(itemized.map((r) => r.totalCents).filter((t): t is number => t !== null));
  const invoices = itemized.flatMap((r) => r.invoiceNumbers.map(normInvoice)).filter(Boolean);
  const out: { description: string; amountCents: number | null }[] = [];
  for (const proof of receipts.filter((r) => r.kind === "PAYMENT_PROOF")) {
    for (const line of proof.lineItems ?? []) {
      const byAmount = line.amountCents !== null && totals.has(line.amountCents);
      const byInvoice = invoices.some((n) => line.description.toUpperCase().includes(n));
      if (!byAmount && !byInvoice) out.push(line);
    }
  }
  return out;
}

export function runChecks(input: CheckInput): Check[] {
  const checks: Check[] = [];
  const { receipts } = input;

  if (!input.noReceipt) {
    if (receipts.length === 0) {
      checks.push({ code: "no_receipt_attached", level: "warning", message: "No receipt is attached." });
    } else if (receipts.some((r) => r.kind === "ITEMIZED")) {
      checks.push({ code: "itemized", level: "ok", message: "An itemized receipt is attached." });
    } else {
      checks.push({
        code: "card_slip_only",
        level: "warning",
        message: "Only a card slip is attached. Add the itemized receipt or invoice.",
      });
    }

    const itemizedTotals = receipts
      .filter((r) => r.kind === "ITEMIZED" && r.totalCents !== null)
      .map((r) => r.totalCents as number);
    if (itemizedTotals.length > 0 && input.totalCents !== null) {
      const sum = itemizedTotals.reduce((a, b) => a + b, 0);
      if (sum === input.totalCents) {
        checks.push({ code: "totals_match", level: "ok", message: "Totals match." });
      } else {
        checks.push({
          code: "totals_mismatch",
          level: "warning",
          message: `Receipts add up to ${formatCents(sum)} but the amount is ${formatCents(input.totalCents)}.`,
        });
      }
    }

    const unexplained = unexplainedLines(receipts);
    if (unexplained.length > 0) {
      checks.push({
        code: "unexplained_lines",
        level: "warning",
        message: `${unexplained.length === 1 ? "A line" : `${unexplained.length} lines`} on the card slip can't be explained by the other receipts.`,
      });
    }

    const hashes = new Set(receipts.map((r) => r.sha256));
    const invoices = new Set(receipts.flatMap((r) => r.invoiceNumbers.map(normInvoice)).filter(Boolean));
    const dupes = input.others
      .filter(
        (o) =>
          o.sha256s.some((h) => hashes.has(h)) || o.invoiceNumbers.map(normInvoice).some((n) => invoices.has(n)),
      )
      .map((o) => o.expenseId);
    if (dupes.length > 0) {
      checks.push({
        code: "duplicate_receipt",
        level: "warning",
        message: "This receipt or invoice number is already on another expense.",
        expenseIds: dupes,
      });
    }
  }

  if (input.teamMeal && input.attendeeCount === 0) {
    checks.push({ code: "team_meal_attendees", level: "warning", message: "Add who attended the team meal." });
  }
  return checks;
}
