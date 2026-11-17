import { describe, expect, it } from "vitest";
import type { ExpenseViewer } from "../../lib/access";
import { OWN, buildPatch, cardChoice, formBlockers, initialForm, permissionsFor } from "../card-form";
import { cardSaveFields, categorySaveFields } from "../CardForms";
import { noReceiptFields, noReceiptMissing } from "../NoReceiptForm";
import { importFields, mappingReady } from "../StatementUpload";
import { view } from "./fixtures";

const viewer = (over: Partial<ExpenseViewer> = {}): ExpenseViewer => ({ userId: "filer", isCore: false, isStaff: false, ownedCardIds: [], ...over });

describe("initialForm and buildPatch", () => {
  it("starts from the expense and sends nothing when untouched", () => {
    const e = view();
    expect(initialForm(e)).toMatchObject({ merchant: "Gnomon Copy", date: "2026-11-17", amount: "36.87", paidWith: OWN, categoryId: "c1" });
    expect(buildPatch(initialForm(e), e, "edit")).toEqual({});
  });
  it("sends only what changed", () => {
    const e = view();
    const f = { ...initialForm(e), merchant: "Copy Shop", amount: "40", date: "" };
    expect(buildPatch(f, e, "edit")).toEqual({ merchant: "Copy Shop", amount: "40", purchasedAt: null });
  });
  it("maps the paid-with choice to a card or personal", () => {
    const e = view();
    expect(buildPatch({ ...initialForm(e), paidWith: cardChoice("k1") }, e, "edit")).toEqual({ paidWith: "STAFF_CARD", cardId: "k1" });
    const staff = view({ paidWith: "STAFF_CARD", cardId: "k1" });
    expect(buildPatch({ ...initialForm(staff), paidWith: OWN }, staff, "edit")).toEqual({ paidWith: "OWN_CARD", cardId: null });
  });
  it("lets an approver change only category and purpose", () => {
    const e = view({ status: "SUBMITTED" });
    const f = { ...initialForm(e), merchant: "Other", categoryId: "c2", purpose: "New" };
    expect(buildPatch(f, e, "coding")).toEqual({ categoryId: "c2", purpose: "New" });
  });
  it("sends the no-receipt reason only on a no-receipt expense", () => {
    const e = view({ noReceipt: true, noReceiptReason: "Lost" });
    expect(buildPatch({ ...initialForm(e), reason: "Lost it" }, e, "edit")).toEqual({ noReceiptReason: "Lost it" });
    const normal = view();
    expect(buildPatch({ ...initialForm(normal), reason: "x" }, normal, "edit")).toEqual({});
  });
});

describe("formBlockers", () => {
  it("is empty for a complete expense", () => {
    expect(formBlockers(initialForm(view()), view())).toEqual([]);
  });
  it("lists what is missing", () => {
    const e = view({ merchant: null, totalCents: null, categoryId: null, purchasedAt: null, paidWith: null });
    expect(formBlockers(initialForm(e), e)).toEqual(
      expect.arrayContaining(["Choose how it was paid.", "Add the merchant.", "Add the purchase date.", "Add the amount.", "Pick a category."]),
    );
  });
  it("asks for the reason on a no-receipt expense", () => {
    const e = view({ noReceipt: true });
    expect(formBlockers(initialForm(e), e)).toContain("Say why there is no receipt.");
  });
  it("follows the form, not the saved expense", () => {
    const e = view();
    expect(formBlockers({ ...initialForm(e), amount: "0" }, e)).toContain("Add the amount.");
  });
});

describe("permissionsFor", () => {
  it("lets the filer edit, submit, and delete a draft", () => {
    expect(permissionsFor(view(), viewer())).toMatchObject({ canEdit: true, canDelete: true, canDecide: false, canWithdraw: false });
  });
  it("lets the filer edit a returned expense but not delete it", () => {
    expect(permissionsFor(view({ status: "RETURNED" }), viewer())).toMatchObject({ canEdit: true, canDelete: false });
  });
  it("lets the filer withdraw but not approve a submitted expense", () => {
    expect(permissionsFor(view({ status: "SUBMITTED" }), viewer())).toMatchObject({ canWithdraw: true, canDecide: false, canEdit: false });
  });
  it("lets staff decide a submitted expense", () => {
    expect(permissionsFor(view({ status: "SUBMITTED" }), viewer({ userId: "s", isStaff: true }))).toMatchObject({ canDecide: true, canEdit: false });
  });
  it("lets a card owner decide only on their own card", () => {
    const e = view({ status: "SUBMITTED", paidWith: "STAFF_CARD", cardId: "k1" });
    expect(permissionsFor(e, viewer({ userId: "o", ownedCardIds: ["k1"] })).canDecide).toBe(true);
    expect(permissionsFor(e, viewer({ userId: "o", ownedCardIds: ["k2"] })).canDecide).toBe(false);
    expect(permissionsFor({ ...e, cardArchived: true }, viewer({ userId: "o", ownedCardIds: ["k1"] })).canDecide).toBe(false);
  });
  it("offers paid only for approved personal-card expenses", () => {
    const approved = view({ status: "APPROVED" });
    expect(permissionsFor(approved, viewer()).canMarkPaid).toBe(true);
    expect(permissionsFor(approved, viewer({ userId: "s", isStaff: true })).canMarkPaid).toBe(true);
    expect(permissionsFor(approved, viewer({ userId: "x" })).canMarkPaid).toBe(false);
    expect(permissionsFor({ ...approved, paidWith: "STAFF_CARD", cardId: "k" }, viewer()).canMarkPaid).toBe(false);
    expect(permissionsFor(view({ status: "PAID" }), viewer()).canMarkPaid).toBe(false);
  });
  it("offers unmatch to the card owner or Core on a matched staff-card expense", () => {
    const e = view({ status: "APPROVED", paidWith: "STAFF_CARD", cardId: "k1", matched: true });
    expect(permissionsFor(e, viewer({ userId: "o", ownedCardIds: ["k1"] })).canUnmatch).toBe(true);
    expect(permissionsFor(e, viewer({ userId: "c", isCore: true })).canUnmatch).toBe(true);
    expect(permissionsFor(e, viewer({ userId: "x" })).canUnmatch).toBe(false);
  });
});

describe("no-receipt form helpers", () => {
  const f = { merchant: " Co-op ", date: "2026-11-17", amount: "12.50", purpose: " Snacks ", categoryId: "c1", paidWith: OWN, reason: " Lost " };
  it("requires a reason, merchant, date, amount and payment", () => {
    expect(noReceiptMissing(f, false)).toBeNull();
    expect(noReceiptMissing({ ...f, reason: " " }, false)).toBe("Say why there is no receipt.");
    expect(noReceiptMissing({ ...f, merchant: "" }, false)).toBe("Add the merchant.");
    expect(noReceiptMissing({ ...f, date: "" }, false)).toBe("Add the purchase date.");
    expect(noReceiptMissing({ ...f, amount: "abc" }, false)).toBe("Add the amount.");
    expect(noReceiptMissing({ ...f, paidWith: "" }, false)).toBe("Choose how it was paid.");
    expect(noReceiptMissing({ ...f, paidWith: "" }, true)).toBeNull();
  });
  it("posts trimmed fields and the payment choice", () => {
    expect(noReceiptFields(f)).toMatchObject({ merchant: "Co-op", reason: "Lost", purpose: "Snacks", paidWith: "OWN_CARD" });
    expect(noReceiptFields({ ...f, paidWith: cardChoice("k1") })).toMatchObject({ paidWith: "STAFF_CARD", cardId: "k1" });
  });
  it("answers a charge instead of choosing a payment", () => {
    const out = noReceiptFields(f, "ch1");
    expect(out.chargeId).toBe("ch1");
    expect(out.paidWith).toBeUndefined();
  });
});

describe("card and statement helpers", () => {
  it("serializes card and category saves", () => {
    expect(cardSaveFields("k1", { nickname: " P ", last4: "1234", ownerId: "o", holderIds: ["a"], defaultCategoryId: "" })).toEqual({
      id: "k1", nickname: "P", last4: "1234", ownerId: "o", holderIds: '["a"]', defaultCategoryId: "",
    });
    expect(cardSaveFields(null, { nickname: "P", last4: "1", ownerId: "o", holderIds: [], defaultCategoryId: "" }).id).toBeUndefined();
    expect(categorySaveFields(null, { label: " T ", chartString: " X ", hints: "a, b" })).toEqual({ label: "T", chartString: "X", hints: "a, b" });
  });
  it("needs three different columns from the header", () => {
    const headers = ["Date", "Description", "Amount"];
    expect(mappingReady(headers, { date: "Date", merchant: "Description", amount: "Amount", invertSign: false })).toBe(true);
    expect(mappingReady(headers, { date: "Date", merchant: "Date", amount: "Amount", invertSign: false })).toBe(false);
    expect(mappingReady(headers, { date: "", merchant: "Description", amount: "Amount", invertSign: false })).toBe(false);
    expect(mappingReady(headers, { date: "Nope", merchant: "Description", amount: "Amount", invertSign: false })).toBe(false);
  });
  it("posts the mapping and the sign toggle", () => {
    const m = { date: "D", merchant: "M", amount: "A", invertSign: true };
    expect(importFields("k1", "csv", m)).toEqual({ cardId: "k1", csv: "csv", date: "D", merchant: "M", amount: "A", invertSign: "1" });
    expect(importFields("k1", "csv", { ...m, invertSign: false }).invertSign).toBeUndefined();
  });
});
