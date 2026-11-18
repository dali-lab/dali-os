import { describe, expect, it } from "vitest";
import { expenseLineItems } from "../line-items";

const line = (description: string, amountCents: number | null, qty?: number) => ({ description, amountCents, ...(qty ? { qty } : {}) });
const slip = { kind: "PAYMENT_PROOF", extracted: { lineItems: [line("Adjustment", -100), line("INV #75085", 1381), line("INV #75078", 2306)] } };
const invoiceA = { kind: "ITEMIZED", extracted: { lineItems: [line("Full Bleed Color", 773), line("Cutting", 100)] } };
const invoiceB = { kind: "ITEMIZED", extracted: { lineItems: [line("Certificates 8.5x11", 486, 3)] } };

describe("expenseLineItems", () => {
  it("lists itemized receipts' lines in order and leaves out the card slip's", () => {
    expect(expenseLineItems([invoiceA, slip, invoiceB])).toEqual([
      { description: "Full Bleed Color", qty: null, amountCents: 773 },
      { description: "Cutting", qty: null, amountCents: 100 },
      { description: "Certificates 8.5x11", qty: 3, amountCents: 486 },
    ]);
  });

  it("falls back to every receipt's lines when none is itemized", () => {
    const other = { kind: "OTHER", extracted: { lineItems: [line("Coffee", 450)] } };
    expect(expenseLineItems([slip, other]).map((l) => l.description)).toEqual(["Adjustment", "INV #75085", "INV #75078", "Coffee"]);
  });

  it("returns nothing for receipts without an extraction", () => {
    expect(expenseLineItems([{ kind: "ITEMIZED", extracted: null }, { kind: "PAYMENT_PROOF", extracted: null }])).toEqual([]);
  });
});
