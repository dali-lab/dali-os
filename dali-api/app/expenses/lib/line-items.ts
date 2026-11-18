import type { ExtractedReceipt } from "./extract.server";

export type DisplayLineItem = { description: string; qty: number | null; amountCents: number | null };

type ReceiptWithLines = { kind: string; extracted: unknown };

const linesOf = (r: ReceiptWithLines): DisplayLineItem[] =>
  ((r.extracted as Partial<ExtractedReceipt> | null)?.lineItems ?? []).map((l) => ({
    description: l.description,
    qty: l.qty ?? null,
    amountCents: l.amountCents ?? null,
  }));

export function expenseLineItems(receipts: ReceiptWithLines[]): DisplayLineItem[] {
  const itemized = receipts.filter((r) => r.kind === "ITEMIZED");
  return (itemized.length > 0 ? itemized : receipts).flatMap(linesOf);
}
