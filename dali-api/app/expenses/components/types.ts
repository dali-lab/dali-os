import type { Check } from "../lib/checks";
import type { ExpenseStatusValue } from "../lib/status";
import type { PaidWithValue } from "./format";

export type ExpenseRow = {
  id: string;
  merchant: string | null;
  purpose: string | null;
  status: ExpenseStatusValue;
  paidWith: PaidWithValue | null;
  cardId: string | null;
  cardLabel: string | null;
  categoryLabel: string | null;
  totalCents: number | null;
  purchasedAt: string | null;
  noReceipt: boolean;
  matched: boolean;
  submitterId: string;
  submitterName: string;
  receiptCount: number;
};

export type ReceiptView = {
  id: string;
  kind: "PAYMENT_PROOF" | "ITEMIZED" | "OTHER";
  contentType: string;
  url: string | null;
};

export type ExpenseView = {
  id: string;
  status: ExpenseStatusValue;
  paidWith: PaidWithValue | null;
  cardId: string | null;
  cardArchived: boolean;
  cardOwnerId: string | null;
  cardLabel: string | null;
  merchant: string | null;
  purchasedAt: string | null;
  totalCents: number | null;
  purpose: string | null;
  categoryId: string | null;
  noReceipt: boolean;
  noReceiptReason: string | null;
  decisionNote: string | null;
  submitterId: string;
  submitterName: string;
  approverName: string | null;
  matched: boolean;
  charge: { merchant: string; postedAt: string; amountCents: number } | null;
  receipts: ReceiptView[];
  lineItems: { description: string; qty: number | null; amountCents: number | null }[];
  checks: Check[];
  suggestion: { categoryId: string; reason: string } | null;
  extractionError: "no_provider" | "quota" | "failed" | null;
  uncertain: ("merchant" | "date" | "total")[];
  chargeId: string | null;
};

export type CardOption = {
  id: string;
  nickname: string;
  last4: string;
  ownerId: string;
  ownerName: string;
  holderIds: string[];
  defaultCategoryId: string | null;
  archived: boolean;
};

export type CategoryOption = {
  id: string;
  label: string;
  chartString: string | null;
  hints: string[];
  archived: boolean;
};

export type PersonRow = { id: string; name: string };

export type ChargeRow = {
  id: string;
  postedAt: string;
  merchant: string;
  amountCents: number;
  state: "matched" | "needs_receipt" | "refund";
  expenseId: string | null;
  expenseMerchant: string | null;
  filedBy: string | null;
};

export type ViewerSummary = {
  userId: string;
  isCore: boolean;
  isStaff: boolean;
  ownedCardIds: string[];
};

export type ActionResult =
  | { ok: true; expenseId?: string; message?: string; summary?: ImportSummaryView; archived?: boolean }
  | { ok: false; error: string; needsConfirm?: { submittedCount: number } };

export type ImportSummaryView = {
  imported: number;
  skipped: number;
  matched: number;
  needsReceipt: number;
  notOnStatement: number;
  ambiguous: number;
  errors: { line: number; message: string }[];
};
