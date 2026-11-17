import { canApproveExpense, canMarkPaid, canMatchCharge, type ExpenseViewer } from "../lib/access";
import { centsToDecimalString, parseMoneyToCents } from "../lib/money";
import { submitBlockers } from "../lib/status";
import { dayInputValue } from "./format";
import type { ExpenseView } from "./types";

export type CardForm = {
  merchant: string;
  date: string;
  amount: string;
  purpose: string;
  categoryId: string;
  paidWith: string;
  reason: string;
};

export const OWN = "OWN";
export const cardChoice = (id: string) => `card:${id}`;

export function initialForm(e: ExpenseView): CardForm {
  return {
    merchant: e.merchant ?? "",
    date: dayInputValue(e.purchasedAt),
    amount: e.totalCents === null ? "" : centsToDecimalString(e.totalCents),
    purpose: e.purpose ?? "",
    categoryId: e.categoryId ?? "",
    paidWith: e.paidWith === "OWN_CARD" ? OWN : e.cardId ? cardChoice(e.cardId) : "",
    reason: e.noReceiptReason ?? "",
  };
}

export type CardMode = "edit" | "coding";

export function buildPatch(form: CardForm, e: ExpenseView, mode: CardMode): Record<string, unknown> {
  const before = initialForm(e);
  const patch: Record<string, unknown> = {};
  if (form.purpose !== before.purpose) patch.purpose = form.purpose;
  if (form.categoryId !== before.categoryId) patch.categoryId = form.categoryId || null;
  if (mode === "coding") return patch;
  if (form.merchant !== before.merchant) patch.merchant = form.merchant;
  if (form.date !== before.date) patch.purchasedAt = form.date || null;
  if (form.amount.trim() !== before.amount) patch.amount = form.amount.trim();
  if (e.noReceipt && form.reason !== before.reason) patch.noReceiptReason = form.reason;
  if (form.paidWith !== before.paidWith) {
    if (form.paidWith === OWN) Object.assign(patch, { paidWith: "OWN_CARD", cardId: null });
    else if (form.paidWith.startsWith("card:")) Object.assign(patch, { paidWith: "STAFF_CARD", cardId: form.paidWith.slice(5) });
    else Object.assign(patch, { paidWith: null, cardId: null });
  }
  return patch;
}

export function formBlockers(form: CardForm, e: ExpenseView): string[] {
  const staff = form.paidWith.startsWith("card:");
  return submitBlockers({
    status: e.status,
    submitterId: e.submitterId,
    paidWith: form.paidWith === OWN ? "OWN_CARD" : staff ? "STAFF_CARD" : null,
    cardId: staff ? form.paidWith.slice(5) : null,
    merchant: form.merchant,
    purchasedAt: form.date || null,
    total: parseMoneyToCents(form.amount),
    categoryId: form.categoryId || null,
    noReceipt: e.noReceipt,
    noReceiptReason: form.reason,
  });
}

export type CardPermissions = {
  isFiler: boolean;
  canEdit: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  canDelete: boolean;
  canMarkPaid: boolean;
  canUnmatch: boolean;
};

export function permissionsFor(e: ExpenseView, viewer: ExpenseViewer): CardPermissions {
  const ref = { submitterId: e.submitterId, paidWith: e.paidWith, cardId: e.cardId, cardArchived: e.cardArchived };
  const isFiler = viewer.userId === e.submitterId;
  return {
    isFiler,
    canEdit: isFiler && (e.status === "DRAFT" || e.status === "RETURNED"),
    canDecide: e.status === "SUBMITTED" && canApproveExpense(viewer, ref),
    canWithdraw: isFiler && e.status === "SUBMITTED",
    canDelete: isFiler && e.status === "DRAFT",
    canMarkPaid: e.status === "APPROVED" && e.paidWith === "OWN_CARD" && canMarkPaid(viewer, ref),
    canUnmatch: e.status === "APPROVED" && e.matched && canMatchCharge(viewer, ref),
  };
}
