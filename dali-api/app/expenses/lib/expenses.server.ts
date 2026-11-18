import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { deleteObjects, getDownloadUrl, getObjectBytes, headObject } from "~/lib/s3.server";
import { canFileOnCard, canViewExpense, expenseTabs, type ExpenseViewer } from "./access";
import { suggestCategory, type CategorySuggestion } from "./categories";
import { runChecks, type Check, type CheckReceipt } from "./checks";
import { ExpenseError } from "./errors";
import { extractReceipts, type ExtractedReceipt, type ReceiptExtraction } from "./extract.server";
import { centsToDecimalString, formatCents, parseMoneyToCents } from "./money";
import {
  RECEIPT_CONTENT_TYPES,
  assertOwnReceiptKey,
  ReceiptKeyError,
  sha256Hex,
  type ReceiptContentType,
} from "./receipts.server";
import { canTransition, type ExpenseAction, type ExpenseState, type TransitionInput } from "./status";

export * from "./cards.server";
export * from "./statements.server";
export { ExpenseError } from "./errors";
export { loadExpenseViewer } from "./viewer.server";

export const MAX_RECEIPTS_PER_EXPENSE = 12;
export const DOWNLOAD_URL_TTL_SECONDS = 300;

type PaidWith = "STAFF_CARD" | "OWN_CARD";

const DETAIL_INCLUDE = {
  receipts: { orderBy: { createdAt: "asc" } },
  card: { select: { id: true, nickname: true, last4: true, ownerId: true, archivedAt: true, defaultCategoryId: true } },
  category: { select: { id: true, label: true, chartString: true } },
  submitter: { select: { id: true, firstName: true, lastName: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
  statementCharge: { select: { id: true, postedAt: true, merchant: true, amount: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRecord = Prisma.ExpenseGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export type ExpenseExtractionJson = {
  summary: ReceiptExtraction["expense"];
  amounts: { subtotalCents: number | null; taxCents: number | null; tipCents: number | null };
  suggestion: CategorySuggestion | null;
  extractionError: ReceiptExtraction["error"];
  chargeId?: string | null;
};

export type ExpenseDetail = Omit<ExpenseRecord, "total" | "receipts" | "statementCharge"> & {
  totalCents: number | null;
  receipts: (ExpenseRecord["receipts"][number] & { url: string | null })[];
  statementCharge: { id: string; postedAt: Date; merchant: string; amountCents: number } | null;
  checks: Check[];
  suggestion: CategorySuggestion | null;
  matched: boolean;
};

const toCents = (v: { toString(): string } | null | undefined) => (v == null ? null : parseMoneyToCents(v.toString()));
const asDate = (v: Date | string | null | undefined) => (v ? (v instanceof Date ? v : new Date(`${v}T00:00:00Z`)) : null);

function stateOf(e: ExpenseRecord): ExpenseState {
  return {
    status: e.status,
    submitterId: e.submitterId,
    paidWith: e.paidWith,
    cardId: e.cardId,
    cardArchived: Boolean(e.card?.archivedAt),
    hasCharge: e.statementChargeId !== null,
    total: toCents(e.total),
    merchant: e.merchant,
    purchasedAt: e.purchasedAt,
    categoryId: e.categoryId,
    noReceipt: e.noReceipt,
    noReceiptReason: e.noReceiptReason,
  };
}

function extractionOf(e: { extraction: unknown }): Partial<ExpenseExtractionJson> {
  return (e.extraction ?? {}) as Partial<ExpenseExtractionJson>;
}

async function load(id: string): Promise<ExpenseRecord> {
  const e = await prisma.expense.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!e) throw new ExpenseError("not_found", "Expense not found.");
  return e;
}

async function loadVisible(actor: ExpenseViewer, id: string): Promise<ExpenseRecord> {
  const e = await load(id);
  if (!canViewExpense(actor, stateOf(e))) throw new ExpenseError("not_found", "Expense not found.");
  return e;
}

function authorize(e: ExpenseRecord, action: ExpenseAction, actor: ExpenseViewer, input?: TransitionInput) {
  const r = canTransition(stateOf(e), action, actor, input);
  if (!r.ok) throw new ExpenseError(r.code, r.reason);
  return r.to;
}

async function guardedUpdate(e: ExpenseRecord, data: Prisma.ExpenseUncheckedUpdateManyInput): Promise<void> {
  const r = await prisma.expense.updateMany({ where: { id: e.id, status: e.status }, data });
  if (r.count !== 1) throw new ExpenseError("conflict", "This expense just changed. Reload and try again.");
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "P2002";
}

async function termIdFor(date: Date | null): Promise<string | null> {
  if (!date) return null;
  const t = await prisma.term.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });
  return t?.id ?? null;
}

async function loadFileableCard(actor: ExpenseViewer, cardId: string) {
  const card = await prisma.expenseCard.findUnique({
    where: { id: cardId },
    select: { id: true, nickname: true, ownerId: true, holderIds: true, holderGroupIds: true, archivedAt: true, defaultCategoryId: true, last4: true },
  });
  if (!card || !canFileOnCard(actor, card)) throw new ExpenseError("invalid", "You can't file on that card.");
  return card;
}

export function expenseLink(id: string): string {
  return `/expenses?expense=${id}`;
}

export async function approverUserIds(e: {
  submitterId: string;
  paidWith: PaidWith | null;
  card: { ownerId: string; archivedAt: Date | null } | null;
}): Promise<string[]> {
  const staff = await prisma.adminMembership.findMany({ where: { isStaff: true }, select: { userId: true } });
  const ids = new Set(staff.map((s) => s.userId));
  if (e.paidWith === "STAFF_CARD" && e.card && !e.card.archivedAt) ids.add(e.card.ownerId);
  ids.delete(e.submitterId);
  return [...ids];
}

async function notifySafely(args: Parameters<typeof notify>[0]): Promise<void> {
  try {
    await notify(args);
  } catch {
    // The state change already happened; a missed notification must not undo it.
  }
}

function titleOf(e: Pick<ExpenseRecord, "merchant" | "total">): string {
  const cents = toCents(e.total);
  return [e.merchant ?? "Expense", cents === null ? null : formatCents(cents)].filter(Boolean).join(" ");
}

async function checksFor(e: ExpenseRecord): Promise<Check[]> {
  const hashes = e.receipts.map((r) => r.sha256);
  const invoices = e.receipts.flatMap((r) => (r.extracted as Partial<ExtractedReceipt> | null)?.invoiceNumbers ?? []);
  const or: Prisma.ExpenseReceiptWhereInput[] = [
    ...(hashes.length ? [{ sha256: { in: hashes } }] : []),
    ...invoices.map((n) => ({ extracted: { path: ["invoiceNumbers"], array_contains: n } })),
  ];
  const others =
    or.length === 0
      ? []
      : await prisma.expense.findMany({
          where: { id: { not: e.id }, receipts: { some: { OR: or } } },
          select: { id: true, receipts: { select: { sha256: true, extracted: true } } },
        });
  const x = extractionOf(e);
  const receipts: CheckReceipt[] = e.receipts.map((r) => {
    const ex = (r.extracted ?? {}) as Partial<ExtractedReceipt>;
    return {
      kind: r.kind,
      sha256: r.sha256,
      invoiceNumbers: ex.invoiceNumbers ?? [],
      totalCents: ex.totalCents ?? null,
      lineItems: ex.lineItems,
    };
  });
  return runChecks({
    noReceipt: e.noReceipt,
    totalCents: toCents(e.total),
    receipts,
    teamMeal: x.summary?.teamMeal ?? false,
    attendeeCount: e.attendeeIds.length,
    others: others.map((o) => ({
      expenseId: o.id,
      sha256s: o.receipts.map((r) => r.sha256),
      invoiceNumbers: o.receipts.flatMap((r) => (r.extracted as Partial<ExtractedReceipt> | null)?.invoiceNumbers ?? []),
    })),
  });
}

async function toDetail(e: ExpenseRecord, opts: { urls: boolean }): Promise<ExpenseDetail> {
  const { total, receipts, statementCharge, ...rest } = e;
  const urls = await Promise.all(
    receipts.map((r) =>
      opts.urls
        ? getDownloadUrl(r.s3Key, { expiresIn: DOWNLOAD_URL_TTL_SECONDS, inline: true, contentType: r.contentType }).catch(() => null)
        : Promise.resolve(null),
    ),
  );
  return {
    ...rest,
    totalCents: toCents(total),
    receipts: receipts.map((r, i) => ({ ...r, url: urls[i] })),
    statementCharge: statementCharge
      ? { id: statementCharge.id, postedAt: statementCharge.postedAt, merchant: statementCharge.merchant, amountCents: toCents(statementCharge.amount) ?? 0 }
      : null,
    checks: await checksFor(e),
    suggestion: extractionOf(e).suggestion ?? null,
    matched: e.statementChargeId !== null,
  };
}

export async function getExpense(actor: ExpenseViewer, id: string): Promise<ExpenseDetail> {
  return toDetail(await loadVisible(actor, id), { urls: true });
}

export type CreateFromReceiptsOptions = { paidWith?: PaidWith | null; cardId?: string | null };

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

export async function createFromReceipts(actor: ExpenseViewer, keys: string[], options: CreateFromReceiptsOptions = {}) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) throw new ExpenseError("invalid", "Add at least one receipt.");
  if (unique.length > MAX_RECEIPTS_PER_EXPENSE) throw new ExpenseError("invalid", `Use up to ${MAX_RECEIPTS_PER_EXPENSE} receipts per expense.`);
  try {
    for (const key of unique) assertOwnReceiptKey(actor.userId, key);
  } catch (e) {
    if (e instanceof ReceiptKeyError) throw new ExpenseError("forbidden", e.message);
    throw e;
  }

  const files = await Promise.all(
    unique.map(async (key) => {
      const head = await headObject(key);
      if (!head) throw new ExpenseError("invalid", "One of the receipts didn't finish uploading.");
      const contentType = (head.contentType ?? "").split(";")[0].trim();
      if (!(RECEIPT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        throw new ExpenseError("invalid", "Receipts can be JPEG, PNG, WebP or PDF files.");
      }
      const { body } = await getObjectBytes(key);
      return { key, contentType: contentType as ReceiptContentType, bytes: new Uint8Array(body), sha256: sha256Hex(body) };
    }),
  );

  const extraction = await extractReceipts(actor.userId, files);
  const primary = extraction.receipts.find((r) => r.kind === "PAYMENT_PROOF") ?? extraction.receipts[0];
  const itemized = extraction.receipts.filter((r) => r.kind === "ITEMIZED");

  let paidWith = options.paidWith ?? null;
  let cardId = options.cardId ?? null;
  if (paidWith === "OWN_CARD") cardId = null;
  if (!paidWith && !cardId && extraction.expense.cardLast4) {
    const mine = await prisma.expenseCard.findMany({
      where: { last4: extraction.expense.cardLast4, archivedAt: null },
      select: { id: true, ownerId: true, holderIds: true, holderGroupIds: true, archivedAt: true },
    });
    const usable = mine.filter((c) => canFileOnCard(actor, c));
    if (usable.length === 1) {
      paidWith = "STAFF_CARD";
      cardId = usable[0].id;
    }
  }
  if (cardId) {
    await loadFileableCard(actor, cardId);
    paidWith = "STAFF_CARD";
  }
  if (paidWith === "STAFF_CARD" && !cardId) throw new ExpenseError("invalid", "Choose which card was used.");

  const [categories, card] = await Promise.all([
    prisma.expenseCategory.findMany({ where: { archivedAt: null }, orderBy: { sortOrder: "asc" } }),
    cardId ? prisma.expenseCard.findUnique({ where: { id: cardId }, select: { nickname: true, defaultCategoryId: true } }) : null,
  ]);
  const suggestion = suggestCategory({
    poRefs: extraction.receipts.map((r) => r.poRef).filter((x): x is string => Boolean(x)),
    lineItems: extraction.receipts.flatMap((r) => r.lineItems.map((l) => l.description)),
    merchants: [extraction.expense.merchant, ...extraction.receipts.map((r) => r.merchant)].filter((x): x is string => Boolean(x)),
    categories,
    card,
  });

  const purchasedAt = asDate(extraction.expense.purchasedAt ?? primary?.date ?? null);
  const totalCents =
    extraction.expense.amountChargedCents ?? primary?.totalCents ?? sumOrNull(itemized.map((r) => r.totalCents));
  const json: ExpenseExtractionJson = {
    summary: extraction.expense,
    amounts: {
      subtotalCents: sumOrNull(itemized.map((r) => r.subtotalCents)),
      taxCents: sumOrNull(itemized.map((r) => r.taxCents)),
      tipCents: sumOrNull(extraction.receipts.map((r) => r.tipCents)),
    },
    suggestion,
    extractionError: extraction.error,
  };

  let created: { id: string };
  try {
    created = await prisma.expense.create({
      data: {
        submitterId: actor.userId,
        paidWith,
        cardId,
        merchant: extraction.expense.merchant ?? primary?.merchant ?? null,
        purchasedAt,
        total: totalCents === null ? null : centsToDecimalString(totalCents),
        currency: primary?.currency?.toUpperCase() ?? "USD",
        purpose: extraction.expense.purpose,
        categoryId: suggestion?.categoryId ?? null,
        termId: await termIdFor(purchasedAt),
        extraction: json as unknown as Prisma.InputJsonValue,
        receipts: {
          create: files.map((f, i) => ({
            s3Key: f.key,
            contentType: f.contentType,
            sha256: f.sha256,
            kind: extraction.receipts[i].kind,
            extracted: extraction.receipts[i] as unknown as Prisma.InputJsonValue,
          })),
        },
      },
      select: { id: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ExpenseError("conflict", "One of those receipts is already on an expense.");
    throw e;
  }
  return toDetail(await load(created.id), { urls: false });
}

export type NoReceiptFields = {
  merchant?: string | null;
  purchasedAt?: Date | string | null;
  totalCents?: number | null;
  purpose?: string | null;
  categoryId?: string | null;
  paidWith?: PaidWith | null;
  cardId?: string | null;
};

export async function createNoReceipt(actor: ExpenseViewer, fields: NoReceiptFields, reason: string, chargeId?: string | null) {
  const noReceiptReason = reason.trim();
  if (!noReceiptReason) throw new ExpenseError("invalid", "Say why there is no receipt.");

  let { merchant, purchasedAt, totalCents, paidWith, cardId } = {
    merchant: fields.merchant ?? null,
    purchasedAt: asDate(fields.purchasedAt),
    totalCents: fields.totalCents ?? null,
    paidWith: fields.paidWith ?? null,
    cardId: fields.cardId ?? null,
  };

  if (chargeId) {
    const charge = await prisma.cardStatementCharge.findUnique({ where: { id: chargeId }, include: { expense: { select: { id: true } } } });
    if (!charge) throw new ExpenseError("not_found", "Charge not found.");
    await loadFileableCard(actor, charge.cardId);
    if (charge.expense) throw new ExpenseError("conflict", "That charge already has an expense.");
    const amount = toCents(charge.amount) ?? 0;
    if (amount <= 0) throw new ExpenseError("invalid", "Refunds don't need a receipt.");
    merchant = merchant ?? charge.merchant;
    purchasedAt = purchasedAt ?? charge.postedAt;
    totalCents = totalCents ?? amount;
    cardId = charge.cardId;
    paidWith = "STAFF_CARD";
  } else if (cardId) {
    await loadFileableCard(actor, cardId);
    paidWith = "STAFF_CARD";
  }
  if (paidWith === "OWN_CARD") cardId = null;
  if (paidWith === "STAFF_CARD" && !cardId) throw new ExpenseError("invalid", "Choose which card was used.");
  if (totalCents !== null && totalCents <= 0) throw new ExpenseError("invalid", "The amount has to be more than zero.");

  const created = await prisma.expense.create({
    data: {
      submitterId: actor.userId,
      paidWith,
      cardId,
      merchant,
      purchasedAt,
      total: totalCents === null ? null : centsToDecimalString(totalCents),
      purpose: fields.purpose ?? null,
      categoryId: fields.categoryId ?? null,
      termId: await termIdFor(purchasedAt),
      noReceipt: true,
      noReceiptReason,
      extraction: { chargeId: chargeId ?? null } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return toDetail(await load(created.id), { urls: false });
}

export type UpdateExpenseInput = {
  merchant?: string | null;
  purchasedAt?: Date | string | null;
  totalCents?: number | null;
  purpose?: string | null;
  categoryId?: string | null;
  projectId?: string | null;
  attendeeIds?: string[];
  paidWith?: PaidWith | null;
  cardId?: string | null;
  noReceiptReason?: string | null;
};

const APPROVER_EDITABLE: (keyof UpdateExpenseInput)[] = ["categoryId", "purpose"];

export async function updateExpense(actor: ExpenseViewer, id: string, patch: UpdateExpenseInput) {
  const e = await loadVisible(actor, id);
  const action: ExpenseAction = e.status === "SUBMITTED" ? "update_coding" : "update";
  authorize(e, action, actor);

  const keys = (Object.keys(patch) as (keyof UpdateExpenseInput)[]).filter((k) => patch[k] !== undefined);
  if (action === "update_coding" && keys.some((k) => !APPROVER_EDITABLE.includes(k))) {
    throw new ExpenseError("forbidden", "Approvers can only change the category and purpose.");
  }

  const data: Prisma.ExpenseUncheckedUpdateManyInput = {};
  if (patch.merchant !== undefined) data.merchant = patch.merchant?.trim() || null;
  if (patch.purpose !== undefined) data.purpose = patch.purpose?.trim() || null;
  if (patch.attendeeIds !== undefined) data.attendeeIds = [...new Set(patch.attendeeIds)];
  if (patch.projectId !== undefined) data.projectId = patch.projectId;
  if (patch.noReceiptReason !== undefined) {
    if (!e.noReceipt) throw new ExpenseError("invalid", "This expense has receipts.");
    data.noReceiptReason = patch.noReceiptReason?.trim() || null;
  }
  if (patch.totalCents !== undefined) {
    if (patch.totalCents !== null && patch.totalCents <= 0) throw new ExpenseError("invalid", "The amount has to be more than zero.");
    data.total = patch.totalCents === null ? null : centsToDecimalString(patch.totalCents);
  }
  if (patch.purchasedAt !== undefined) {
    const d = asDate(patch.purchasedAt);
    if (d && Number.isNaN(d.getTime())) throw new ExpenseError("invalid", "That date isn't valid.");
    data.purchasedAt = d;
    data.termId = await termIdFor(d);
  }
  if (patch.categoryId !== undefined) {
    if (patch.categoryId) {
      const c = await prisma.expenseCategory.findFirst({ where: { id: patch.categoryId, archivedAt: null }, select: { id: true } });
      if (!c) throw new ExpenseError("invalid", "Pick an active category.");
    }
    data.categoryId = patch.categoryId;
  }
  if (patch.paidWith !== undefined || patch.cardId !== undefined) {
    const paidWith = patch.paidWith === undefined ? e.paidWith : patch.paidWith;
    const cardId = paidWith === "OWN_CARD" ? null : patch.cardId === undefined ? e.cardId : patch.cardId;
    if (cardId && cardId !== e.cardId) await loadFileableCard(actor, cardId);
    data.paidWith = cardId ? "STAFF_CARD" : paidWith;
    data.cardId = cardId;
  }

  if (Object.keys(data).length > 0) await guardedUpdate(e, data);
  return toDetail(await load(id), { urls: false });
}

export async function submitExpense(actor: ExpenseViewer, id: string) {
  const e = await loadVisible(actor, id);
  authorize(e, "submit", actor);
  await guardedUpdate(e, {
    status: "SUBMITTED",
    submittedAt: new Date(),
    approverId: null,
    decidedAt: null,
    decisionNote: null,
  });
  const recipients = await approverUserIds(e);
  const submitter = `${e.submitter.firstName} ${e.submitter.lastName}`.trim();
  await notifySafely({
    eventType: "expense.submitted",
    createdByUserId: actor.userId,
    message: { title: `Expense to approve: ${titleOf(e)}`, body: [submitter, e.purpose].filter(Boolean).join(": "), link: expenseLink(id) },
    recipients: recipients.map((userId) => ({ userId })),
  });
  return toDetail(await load(id), { urls: false });
}

export async function withdrawExpense(actor: ExpenseViewer, id: string) {
  const e = await loadVisible(actor, id);
  authorize(e, "withdraw", actor);
  await guardedUpdate(e, { status: "DRAFT", submittedAt: null, approverId: null, decidedAt: null, decisionNote: null });
  return toDetail(await load(id), { urls: false });
}

export async function deleteDraft(actor: ExpenseViewer, id: string): Promise<void> {
  const e = await loadVisible(actor, id);
  authorize(e, "delete", actor);
  const r = await prisma.expense.deleteMany({ where: { id, status: "DRAFT" } });
  if (r.count !== 1) throw new ExpenseError("conflict", "This expense just changed. Reload and try again.");
  await deleteObjects(e.receipts.map((x) => x.s3Key)).catch(() => undefined);
}

export type Decision = { decision: "approve" | "return"; note?: string };

export async function decideExpense(actor: ExpenseViewer, id: string, input: Decision) {
  const e = await loadVisible(actor, id);
  const note = input.note?.trim() || null;
  const action = input.decision === "approve" ? "approve" : "return";
  authorize(e, action, actor, { note });

  const data: Prisma.ExpenseUncheckedUpdateManyInput = {
    status: action === "approve" ? "APPROVED" : "RETURNED",
    approverId: actor.userId,
    decidedAt: new Date(),
    decisionNote: note,
  };
  if (action === "approve") {
    if (!e.category) throw new ExpenseError("incomplete", "Pick a category before approving.");
    data.chartString = e.category.chartString;
    const chargeId = extractionOf(e).chargeId;
    if (chargeId && e.cardId) {
      const charge = await prisma.cardStatementCharge.findFirst({
        where: { id: chargeId, cardId: e.cardId, expense: { is: null } },
        select: { id: true },
      });
      if (charge) data.statementChargeId = charge.id;
    }
  }
  try {
    await guardedUpdate(e, data);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    delete data.statementChargeId;
    await guardedUpdate(e, data);
  }

  await notifySafely({
    eventType: action === "approve" ? "expense.approved" : "expense.returned",
    createdByUserId: actor.userId,
    message: {
      title: `${action === "approve" ? "Expense approved" : "Expense returned"}: ${titleOf(e)}`,
      body: action === "return" ? note : null,
      link: expenseLink(id),
    },
    recipients: [{ userId: e.submitterId }],
  });
  return toDetail(await load(id), { urls: false });
}

export async function markPaid(actor: ExpenseViewer, id: string) {
  const e = await loadVisible(actor, id);
  authorize(e, "mark_paid", actor);
  await guardedUpdate(e, { status: "PAID", paidAt: new Date() });
  if (actor.userId !== e.submitterId) {
    await notifySafely({
      eventType: "expense.paid",
      createdByUserId: actor.userId,
      message: { title: `Expense paid: ${titleOf(e)}`, link: expenseLink(id) },
      recipients: [{ userId: e.submitterId }],
    });
  }
  return toDetail(await load(id), { urls: false });
}

export async function matchCharge(actor: ExpenseViewer, expenseId: string, chargeId: string) {
  const e = await loadVisible(actor, expenseId);
  authorize(e, "match", actor);
  const charge = await prisma.cardStatementCharge.findUnique({ where: { id: chargeId } });
  if (!charge || charge.cardId !== e.cardId) throw new ExpenseError("invalid", "That charge isn't on this expense's card.");
  if ((toCents(charge.amount) ?? 0) <= 0) throw new ExpenseError("invalid", "Refunds don't match expenses.");
  try {
    await guardedUpdate(e, { statementChargeId: chargeId });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ExpenseError("conflict", "That charge is already matched.");
    throw err;
  }
  return toDetail(await load(expenseId), { urls: false });
}

export async function unmatchCharge(actor: ExpenseViewer, expenseId: string) {
  const e = await loadVisible(actor, expenseId);
  authorize(e, "unmatch", actor);
  await guardedUpdate(e, { statementChargeId: null });
  return toDetail(await load(expenseId), { urls: false });
}

export type ExpenseScope = "mine" | "approvals" | "all";

export type ExpenseFilters = {
  status?: ExpenseState["status"][];
  cardId?: string;
  categoryId?: string;
  termId?: string;
  from?: Date;
  to?: Date;
  noReceipt?: boolean;
  outstanding?: boolean;
  limit?: number;
  offset?: number;
};

export function scopeWhere(actor: ExpenseViewer, scope: ExpenseScope): Prisma.ExpenseWhereInput {
  const tabs = expenseTabs(actor);
  if (scope === "mine") return { submitterId: actor.userId };
  if (scope === "all") {
    if (!tabs.all) throw new ExpenseError("forbidden", "Only Core can see every expense.");
    return {};
  }
  if (!tabs.approvals) throw new ExpenseError("forbidden", "You don't approve any expenses.");
  if (actor.isStaff) return { submitterId: { not: actor.userId } };
  return {
    submitterId: { not: actor.userId },
    paidWith: "STAFF_CARD",
    cardId: { in: [...actor.ownedCardIds] },
    card: { archivedAt: null },
  };
}

export async function listExpenses(actor: ExpenseViewer, scope: ExpenseScope = "mine", filters: ExpenseFilters = {}) {
  const and: Prisma.ExpenseWhereInput[] = [scopeWhere(actor, scope)];
  const status = filters.status ?? (scope === "approvals" ? (["SUBMITTED"] as const) : undefined);
  if (status?.length) and.push({ status: { in: [...status] } });
  if (filters.cardId) and.push({ cardId: filters.cardId });
  if (filters.categoryId) and.push({ categoryId: filters.categoryId });
  if (filters.termId) and.push({ termId: filters.termId });
  if (filters.from || filters.to) and.push({ purchasedAt: { gte: filters.from, lte: filters.to } });
  if (filters.noReceipt !== undefined) and.push({ noReceipt: filters.noReceipt });
  if (filters.outstanding) and.push({ status: "APPROVED", paidWith: "OWN_CARD" });

  const rows = await prisma.expense.findMany({
    where: { AND: and },
    include: { ...DETAIL_INCLUDE, receipts: { select: { id: true, kind: true } } },
    orderBy: [{ purchasedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: Math.min(filters.limit ?? 200, 500),
    skip: filters.offset ?? 0,
  });
  return rows.map(({ total, extraction: _x, ...row }) => ({
    ...row,
    totalCents: toCents(total),
    matched: row.statementChargeId !== null,
  }));
}
