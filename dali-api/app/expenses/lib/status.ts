import { canApproveExpense, canMarkPaid, canMatchCharge, type ExpenseViewer } from "./access";

export type ExpenseStatusValue = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "PAID";

export type ExpenseAction =
  | "update"
  | "submit"
  | "withdraw"
  | "delete"
  | "approve"
  | "return"
  | "update_coding"
  | "mark_paid"
  | "match"
  | "unmatch";

export type ExpenseState = {
  status: ExpenseStatusValue;
  submitterId: string;
  paidWith: "STAFF_CARD" | "OWN_CARD" | null;
  cardId: string | null;
  cardArchived?: boolean;
  hasCharge?: boolean;
  total?: number | null;
  merchant?: string | null;
  purchasedAt?: Date | string | null;
  categoryId?: string | null;
  noReceipt?: boolean;
  noReceiptReason?: string | null;
};

export type TransitionResult =
  | { ok: true; to: ExpenseStatusValue | "DELETED" }
  | { ok: false; code: TransitionRejection; reason: string };

export type TransitionRejection =
  | "forbidden"
  | "invalid_status"
  | "self_approval"
  | "note_required"
  | "wrong_flow"
  | "incomplete"
  | "charge_state";

export type TransitionInput = { note?: string | null };

const reject = (code: TransitionRejection, reason: string): TransitionResult => ({ ok: false, code, reason });

export function submitBlockers(e: ExpenseState): string[] {
  const out: string[] = [];
  if (!e.paidWith) out.push("Choose how it was paid.");
  if (e.paidWith === "STAFF_CARD" && !e.cardId) out.push("Choose which card was used.");
  if (!e.merchant?.trim()) out.push("Add the merchant.");
  if (!e.purchasedAt) out.push("Add the purchase date.");
  if (e.total === null || e.total === undefined || e.total <= 0) out.push("Add the amount.");
  if (!e.categoryId) out.push("Pick a category.");
  if (e.noReceipt && !e.noReceiptReason?.trim()) out.push("Say why there is no receipt.");
  return out;
}

const EDITABLE: readonly ExpenseStatusValue[] = ["DRAFT", "RETURNED"];

export function canTransition(
  expense: ExpenseState,
  action: ExpenseAction,
  actor: ExpenseViewer,
  input: TransitionInput = {},
): TransitionResult {
  const isFiler = actor.userId === expense.submitterId;
  const wrongStatus = () =>
    reject("invalid_status", `Can't ${action.replace("_", " ")} an expense that is ${expense.status.toLowerCase()}.`);

  switch (action) {
    case "update":
      if (!EDITABLE.includes(expense.status)) return wrongStatus();
      if (!isFiler) return reject("forbidden", "Only the person who filed it can edit it.");
      return { ok: true, to: expense.status };

    case "submit": {
      if (!EDITABLE.includes(expense.status)) return wrongStatus();
      if (!isFiler) return reject("forbidden", "Only the person who filed it can submit it.");
      const blockers = submitBlockers(expense);
      if (blockers.length) return reject("incomplete", blockers[0]);
      return { ok: true, to: "SUBMITTED" };
    }

    case "withdraw":
      if (expense.status !== "SUBMITTED") return wrongStatus();
      if (!isFiler) return reject("forbidden", "Only the person who filed it can withdraw it.");
      return { ok: true, to: "DRAFT" };

    case "delete":
      if (expense.status !== "DRAFT") return wrongStatus();
      if (!isFiler) return reject("forbidden", "Only the person who filed it can delete it.");
      return { ok: true, to: "DELETED" };

    case "approve":
    case "return":
    case "update_coding": {
      if (expense.status !== "SUBMITTED") return wrongStatus();
      if (isFiler) {
        return action === "update_coding"
          ? reject("forbidden", "Only an approver can change this while it's submitted.")
          : reject("self_approval", "You can't decide your own expense.");
      }
      if (!canApproveExpense(actor, expense)) {
        return reject("forbidden", "Only the card owner or staff can decide this expense.");
      }
      if (action === "return" && !input.note?.trim()) {
        return reject("note_required", "Add a note so they know what to fix.");
      }
      if (action === "update_coding") return { ok: true, to: "SUBMITTED" };
      return { ok: true, to: action === "approve" ? "APPROVED" : "RETURNED" };
    }

    case "mark_paid":
      if (expense.status !== "APPROVED") return wrongStatus();
      if (expense.paidWith !== "OWN_CARD") return reject("wrong_flow", "Only out-of-pocket expenses are paid back.");
      if (!canMarkPaid(actor, expense)) return reject("forbidden", "Only staff or the filer can mark it paid.");
      return { ok: true, to: "PAID" };

    case "match":
    case "unmatch": {
      if (expense.status !== "APPROVED") return wrongStatus();
      if (expense.paidWith !== "STAFF_CARD") return reject("wrong_flow", "Only staff card expenses match a statement.");
      if (!canMatchCharge(actor, expense)) return reject("forbidden", "Only the card owner or Core can match charges.");
      if (action === "match" && expense.hasCharge) return reject("charge_state", "Already matched to a charge.");
      if (action === "unmatch" && !expense.hasCharge) return reject("charge_state", "Not matched to a charge.");
      return { ok: true, to: "APPROVED" };
    }
  }
}

export function nextStatus(
  expense: ExpenseState,
  action: ExpenseAction,
  actor: ExpenseViewer,
  input?: TransitionInput,
): ExpenseStatusValue | "DELETED" | null {
  const r = canTransition(expense, action, actor, input);
  return r.ok ? r.to : null;
}
