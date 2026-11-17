import type { PillTone } from "~/components/ui/Pill";
import type { ExpenseStatusValue } from "../lib/status";

export type PaidWithValue = "STAFF_CARD" | "OWN_CARD";

type StatusInput = { status: ExpenseStatusValue; paidWith: PaidWithValue | null; matched?: boolean };

export function statusPill({ status, paidWith, matched }: StatusInput): { label: string; tone: PillTone } {
  switch (status) {
    case "DRAFT":
      return { label: "Draft", tone: "neutral" };
    case "SUBMITTED":
      return { label: "Waiting on approval", tone: "warning" };
    case "RETURNED":
      return { label: "Returned", tone: "danger" };
    case "PAID":
      return { label: "Paid", tone: "success" };
    case "APPROVED":
      if (paidWith === "STAFF_CARD") return { label: matched ? "Matched" : "Approved", tone: "success" };
      return { label: "Approved, not paid yet", tone: "accent" };
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return "No date";
  const iso = value instanceof Date ? value.toISOString() : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "No date";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function dayInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const iso = value instanceof Date ? value.toISOString() : value;
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "";
}

export function cardLabel(card: { nickname: string; last4: string }): string {
  return `${card.nickname} ··${card.last4}`;
}

export function paidWithLabel(paidWith: PaidWithValue | null, card: { nickname: string; last4: string } | null): string {
  if (paidWith === "OWN_CARD") return "Personal card";
  if (paidWith === "STAFF_CARD" && card) return cardLabel(card);
  return "Not chosen";
}

export const RECEIPT_KIND_LABEL = {
  PAYMENT_PROOF: "Card slip",
  ITEMIZED: "Invoice",
  OTHER: "Other",
} as const;
