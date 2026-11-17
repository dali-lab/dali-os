import { describe, expect, it } from "vitest";
import {
  amountsAgree,
  datesAgree,
  findRefundOriginal,
  matchCharges,
  merchantsAgree,
  signalLabel,
  type MatchCharge,
  type MatchExpense,
} from "../matching";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const exp = (id: string, over: Partial<MatchExpense> = {}): MatchExpense => ({
  id,
  cardId: "c1",
  merchant: "Gnomon Copy",
  purchasedAt: d("2026-11-17"),
  totalCents: 3687,
  ...over,
});
const chg = (id: string, over: Partial<MatchCharge> = {}): MatchCharge => ({
  id,
  cardId: "c1",
  merchant: "GNOMON COPY HANOVER NH",
  postedAt: d("2026-11-18"),
  amountCents: 3687,
  ...over,
});

describe("signals", () => {
  it("agrees on merchant by containment either way, normalized", () => {
    expect(merchantsAgree("Gnomon Copy", "GNOMON COPY #12 HANOVER")).toBe(true);
    expect(merchantsAgree("SQ *Co-op Food", "co op food")).toBe(true);
    expect(merchantsAgree("Staples", "Office Depot")).toBe(false);
    expect(merchantsAgree("", "Staples")).toBe(false);
  });
  it("agrees on dates within three days only", () => {
    expect(datesAgree(d("2026-11-17"), d("2026-11-20"))).toBe(true);
    expect(datesAgree(d("2026-11-20"), d("2026-11-17"))).toBe(true);
    expect(datesAgree(d("2026-11-17"), d("2026-11-21"))).toBe(false);
  });
  it("agrees on amount exactly or inside the tip window", () => {
    const meal = exp("e", { totalCents: 5000, subtotalCents: 4000, taxCents: 300, tipCents: 700 });
    expect(amountsAgree(meal, 5000)).toBe(true);
    expect(amountsAgree(meal, 4300)).toBe(true);
    expect(amountsAgree(meal, 4700)).toBe(true);
    expect(amountsAgree(meal, 4299)).toBe(false);
    expect(amountsAgree(meal, 5001)).toBe(false);
  });
  it("ignores the window without a tip", () => {
    const e = exp("e", { totalCents: 5000, subtotalCents: 4000, taxCents: 300, tipCents: 0 });
    expect(amountsAgree(e, 4500)).toBe(false);
    expect(amountsAgree(exp("e", { totalCents: 5000, tipCents: 100 }), 4500)).toBe(false);
  });
  it("labels the signals", () => {
    expect(signalLabel({ amount: true, date: true, merchant: false })).toBe("amount and date");
    expect(signalLabel({ amount: true, date: true, merchant: true })).toBe("amount, date and merchant");
    expect(signalLabel({ amount: true, date: false, merchant: false })).toBe("amount");
  });
});

describe("matchCharges", () => {
  it("matches on exact amount plus date and reports the signals", () => {
    const out = matchCharges([chg("c")], [exp("e")]);
    expect(out.matches).toEqual([
      { chargeId: "c", expenseId: "e", signals: { amount: true, date: true, merchant: true } },
    ]);
    expect(out.unmatchedChargeIds).toEqual([]);
    expect(out.unmatchedExpenseIds).toEqual([]);
  });
  it("matches amount plus merchant when the date is off", () => {
    const out = matchCharges([chg("c", { postedAt: d("2026-12-30") })], [exp("e")]);
    expect(out.matches[0].signals).toEqual({ amount: true, date: false, merchant: true });
  });
  it("matches amount plus date when the merchant differs", () => {
    const out = matchCharges([chg("c", { merchant: "SQ *GC" })], [exp("e")]);
    expect(out.matches[0].signals).toEqual({ amount: true, date: true, merchant: false });
  });
  it("does not match on amount alone", () => {
    const out = matchCharges([chg("c", { merchant: "Other", postedAt: d("2026-12-30") })], [exp("e")]);
    expect(out.matches).toEqual([]);
    expect(out.unmatchedChargeIds).toEqual(["c"]);
    expect(out.unmatchedExpenseIds).toEqual(["e"]);
  });
  it("matches date and merchant without the amount when unique both ways", () => {
    const out = matchCharges([chg("c", { amountCents: 9999 })], [exp("e")]);
    expect(out.matches[0].signals).toEqual({ amount: false, date: true, merchant: true });
  });
  it("matches inside the tip window", () => {
    const meal = exp("e", { totalCents: 5000, subtotalCents: 4000, taxCents: 300, tipCents: 700 });
    expect(matchCharges([chg("c", { amountCents: 4500 })], [meal]).matches).toHaveLength(1);
  });
  it("does not match across cards", () => {
    expect(matchCharges([chg("c", { cardId: "c2" })], [exp("e")]).matches).toEqual([]);
  });
  it("does not match negative charges to expenses", () => {
    const out = matchCharges([chg("c", { amountCents: -3687 })], [exp("e")]);
    expect(out.matches).toEqual([]);
    expect(out.unmatchedChargeIds).toEqual([]);
  });
  it("leaves two expenses for one charge to the card owner", () => {
    const out = matchCharges([chg("c")], [exp("e1"), exp("e2")]);
    expect(out.matches).toEqual([]);
    expect(out.ambiguousCharges).toEqual([{ chargeId: "c", expenseIds: ["e1", "e2"] }]);
    expect(out.ambiguousExpenses).toEqual([]);
  });
  it("leaves two charges for one expense to the card owner", () => {
    const out = matchCharges([chg("c1"), chg("c2")], [exp("e")]);
    expect(out.matches).toEqual([]);
    expect(out.ambiguousExpenses).toEqual([{ expenseId: "e", chargeIds: ["c1", "c2"] }]);
  });
  it("does not auto-match the same charge twice in a day to one expense", () => {
    const out = matchCharges([chg("c1"), chg("c2")], [exp("e")]);
    expect(out.matches).toHaveLength(0);
  });
  it("matches unambiguous pairs next to an ambiguous one", () => {
    const out = matchCharges(
      [chg("c1"), chg("c2"), chg("c3", { merchant: "Staples", amountCents: 1000 })],
      [exp("e1"), exp("e2"), exp("e3", { merchant: "Staples", totalCents: 1000 })],
    );
    expect(out.matches.map((m) => m.chargeId)).toEqual(["c3"]);
    expect(out.ambiguousCharges.map((a) => a.chargeId).sort()).toEqual(["c1", "c2"]);
  });
});

describe("findRefundOriginal", () => {
  const original = chg("orig", { postedAt: d("2026-11-10"), amountCents: 2500, merchant: "Staples #55" });
  const refund = chg("ref", { postedAt: d("2026-11-15"), amountCents: -2500, merchant: "STAPLES" });
  it("links a refund to the earlier charge of the same merchant and amount", () => {
    expect(findRefundOriginal(refund, [original, refund])).toBe("orig");
  });
  it("picks the most recent earlier original", () => {
    const older = { ...original, id: "older", postedAt: d("2026-11-01") };
    expect(findRefundOriginal(refund, [older, original])).toBe("orig");
  });
  it("finds nothing for a different amount, card, merchant, or a later charge", () => {
    expect(findRefundOriginal(refund, [{ ...original, amountCents: 2600 }])).toBeNull();
    expect(findRefundOriginal(refund, [{ ...original, cardId: "c2" }])).toBeNull();
    expect(findRefundOriginal(refund, [{ ...original, merchant: "Apple" }])).toBeNull();
    expect(findRefundOriginal(refund, [{ ...original, postedAt: d("2026-11-20") }])).toBeNull();
  });
  it("ignores positive charges", () => {
    expect(findRefundOriginal(original, [original, refund])).toBeNull();
  });
});
