import { describe, expect, it } from "vitest";
import { runChecks, unexplainedLines, type CheckInput, type CheckReceipt } from "../checks";

const slip: CheckReceipt = {
  kind: "PAYMENT_PROOF",
  sha256: "h0",
  invoiceNumbers: [],
  totalCents: 3687,
  lineItems: [
    { description: "INV #75085", amountCents: 1381 },
    { description: "INV #75078", amountCents: 2306 },
  ],
};
const inv = (n: string, total: number, sha = `h${n}`): CheckReceipt => ({
  kind: "ITEMIZED",
  sha256: sha,
  invoiceNumbers: [n],
  totalCents: total,
});
const base = (over: Partial<CheckInput> = {}): CheckInput => ({
  noReceipt: false,
  totalCents: 3687,
  receipts: [slip, inv("75085", 1381), inv("75078", 2306)],
  teamMeal: false,
  attendeeCount: 0,
  others: [],
  ...over,
});
const codes = (i: CheckInput) => runChecks(i).map((c) => `${c.level}:${c.code}`);

describe("runChecks", () => {
  it("passes the Gnomon example", () => {
    expect(codes(base())).toEqual(["ok:itemized", "ok:totals_match"]);
  });
  it("warns when only a card slip is attached", () => {
    expect(codes(base({ receipts: [slip] }))).toContain("warning:card_slip_only");
  });
  it("warns when nothing is attached", () => {
    expect(codes(base({ receipts: [] }))).toEqual(["warning:no_receipt_attached"]);
  });
  it("skips receipt checks for a no-receipt expense", () => {
    expect(codes(base({ noReceipt: true, receipts: [] }))).toEqual([]);
  });
  it("warns when itemized totals do not add up to the amount", () => {
    const out = runChecks(base({ totalCents: 4000 }));
    const mismatch = out.find((c) => c.code === "totals_mismatch");
    expect(mismatch?.level).toBe("warning");
    expect(mismatch?.message).toContain("$36.87");
    expect(mismatch?.message).toContain("$40.00");
  });
  it("warns about slip lines no other receipt explains, without blocking", () => {
    const withExtra: CheckReceipt = {
      ...slip,
      lineItems: [...(slip.lineItems ?? []), { description: "Adjustment", amountCents: -100 }],
    };
    const out = runChecks(base({ receipts: [withExtra, inv("75085", 1381), inv("75078", 2306)] }));
    expect(out.find((c) => c.code === "unexplained_lines")?.level).toBe("warning");
    expect(unexplainedLines([withExtra, inv("75085", 1381), inv("75078", 2306)])).toEqual([
      { description: "Adjustment", amountCents: -100 },
    ]);
  });
  it("does not call slip lines unexplained when nothing itemizes them", () => {
    expect(unexplainedLines([slip])).toEqual([]);
  });
  it("explains a slip line by invoice number even when the amount differs", () => {
    expect(unexplainedLines([slip, inv("75085", 1400), inv("75078", 2306)])).toEqual([]);
  });
  it("warns on a duplicate image hash", () => {
    const out = runChecks(base({ others: [{ expenseId: "x1", sha256s: ["h75085"], invoiceNumbers: [] }] }));
    expect(out.find((c) => c.code === "duplicate_receipt")).toMatchObject({ level: "warning", expenseIds: ["x1"] });
  });
  it("warns on a duplicate invoice number, ignoring case and prefix", () => {
    const out = runChecks(base({ others: [{ expenseId: "x2", sha256s: [], invoiceNumbers: ["inv #75078"] }] }));
    expect(out.find((c) => c.code === "duplicate_receipt")?.expenseIds).toEqual(["x2"]);
  });
  it("does not flag unrelated expenses", () => {
    expect(codes(base({ others: [{ expenseId: "x", sha256s: ["zzz"], invoiceNumbers: ["999"] }] }))).not.toContain(
      "warning:duplicate_receipt",
    );
  });
  it("asks a team meal for attendees", () => {
    expect(codes(base({ teamMeal: true }))).toContain("warning:team_meal_attendees");
    expect(codes(base({ teamMeal: true, attendeeCount: 3 }))).not.toContain("warning:team_meal_attendees");
  });
  it("still asks a no-receipt team meal for attendees", () => {
    expect(codes(base({ noReceipt: true, receipts: [], teamMeal: true }))).toEqual(["warning:team_meal_attendees"]);
  });
  it("never returns a blocking level", () => {
    const all = runChecks(
      base({ receipts: [slip], teamMeal: true, others: [{ expenseId: "x", sha256s: ["h0"], invoiceNumbers: [] }] }),
    );
    expect(all.every((c) => c.level === "ok" || c.level === "warning")).toBe(true);
  });
});
