import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { isValidChartString } from "~/lib/chart-string";
import { ACTIVE_LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { canFileOnCard, canManageCards, canManageCategories, isCardHolderGroup, type ExpenseViewer } from "./access";
import { auditExpense } from "./audit.server";
import { ExpenseError } from "./errors";

const CARD_SELECT = {
  id: true,
  nickname: true,
  last4: true,
  ownerId: true,
  holderIds: true,
  holderGroupIds: true,
  defaultCategoryId: true,
  archivedAt: true,
  createdAt: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ExpenseCardSelect;

export type CardInput = {
  nickname: string;
  last4: string;
  ownerId: string;
  holderIds?: string[];
  holderGroupIds?: string[];
  defaultCategoryId?: string | null;
};

export const CARD_HOLDER_WHERE = {
  OR: [ACTIVE_LAB_MEMBER_WHERE, { adminMembership: { is: { isStaff: true } } }],
} satisfies Prisma.UserWhereInput;

export type CategoryInput = {
  label: string;
  chartString?: string | null;
  hints?: string[];
  sortOrder?: number;
};

function requireCore(allowed: boolean): void {
  if (!allowed) throw new ExpenseError("forbidden", "Only Core can change cards and categories.");
}

async function assertStaffOwner(ownerId: string): Promise<void> {
  const m = await prisma.adminMembership.findFirst({ where: { userId: ownerId, isStaff: true }, select: { id: true } });
  if (!m) throw new ExpenseError("invalid", "A card's owner has to be a staff member.");
}

function cleanCard(input: Partial<CardInput>): Partial<CardInput> {
  const out: Partial<CardInput> = {};
  if (input.nickname !== undefined) {
    const nickname = input.nickname.trim();
    if (!nickname) throw new ExpenseError("invalid", "Give the card a nickname.");
    out.nickname = nickname;
  }
  if (input.last4 !== undefined) {
    if (!/^\d{4}$/.test(input.last4)) throw new ExpenseError("invalid", "Use the last four digits only.");
    out.last4 = input.last4;
  }
  if (input.ownerId !== undefined) out.ownerId = input.ownerId;
  if (input.holderIds !== undefined) out.holderIds = [...new Set(input.holderIds)];
  if (input.holderGroupIds !== undefined) out.holderGroupIds = [...new Set(input.holderGroupIds)];
  if (input.defaultCategoryId !== undefined) out.defaultCategoryId = input.defaultCategoryId;
  return out;
}

async function assertHolders(data: Partial<CardInput>): Promise<void> {
  if (data.holderIds?.length) {
    const found = await prisma.user.count({ where: { id: { in: data.holderIds }, ...CARD_HOLDER_WHERE } });
    if (found !== data.holderIds.length) throw new ExpenseError("invalid", "Card holders have to be current lab members.");
  }
  if (data.holderGroupIds?.length) {
    const groups = await prisma.groupDefinition.findMany({
      where: { id: { in: data.holderGroupIds }, archivedAt: null },
      select: { systemKey: true },
    });
    if (groups.length !== data.holderGroupIds.length || !groups.every(isCardHolderGroup)) {
      throw new ExpenseError("invalid", "Card holder groups have to be active lab groups.");
    }
  }
}

async function assertCategoryExists(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const c = await prisma.expenseCategory.findUnique({ where: { id }, select: { id: true } });
  if (!c) throw new ExpenseError("invalid", "That category doesn't exist.");
}

export async function listCategories(opts: { includeArchived?: boolean } = {}) {
  return prisma.expenseCategory.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
}

export async function createCategory(actor: ExpenseViewer, input: CategoryInput) {
  requireCore(canManageCategories(actor));
  const label = input.label.trim();
  if (!label) throw new ExpenseError("invalid", "Give the category a name.");
  const chartString = cleanChartString(input.chartString);
  const last = await prisma.expenseCategory.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const category = await prisma.expenseCategory.create({
    data: {
      label,
      chartString,
      hints: cleanHints(input.hints),
      sortOrder: input.sortOrder ?? (last?.sortOrder ?? -1) + 1,
    },
  });
  await auditExpense(actor, "expense.category.create", category.id, { label, chartString });
  return category;
}

function cleanChartString(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  if (!isValidChartString(raw)) throw new ExpenseError("invalid", "That isn't a valid chart string.");
  return raw.trim().toUpperCase();
}

function cleanHints(hints: string[] | undefined): string[] {
  return [...new Set((hints ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean))];
}

export async function updateCategory(actor: ExpenseViewer, id: string, input: Partial<CategoryInput>) {
  requireCore(canManageCategories(actor));
  const data: Prisma.ExpenseCategoryUpdateInput = {};
  if (input.label !== undefined) {
    if (!input.label.trim()) throw new ExpenseError("invalid", "Give the category a name.");
    data.label = input.label.trim();
  }
  if (input.chartString !== undefined) data.chartString = cleanChartString(input.chartString);
  if (input.hints !== undefined) data.hints = cleanHints(input.hints);
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  try {
    const category = await prisma.expenseCategory.update({ where: { id }, data });
    await auditExpense(actor, "expense.category.update", id, { fields: Object.keys(data) });
    return category;
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") throw new ExpenseError("not_found", "Category not found.");
    throw e;
  }
}

export async function archiveCategory(actor: ExpenseViewer, id: string) {
  requireCore(canManageCategories(actor));
  const r = await prisma.expenseCategory.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } });
  if (r.count > 0) await auditExpense(actor, "expense.category.archive", id);
  return { archived: r.count > 0 };
}

export async function listCards(actor: ExpenseViewer, opts: { includeArchived?: boolean } = {}) {
  const rows = await prisma.expenseCard.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    select: CARD_SELECT,
    orderBy: { nickname: "asc" },
  });
  if (actor.isCore) return rows;
  return rows.filter((c) => canFileOnCard(actor, c) || actor.ownedCardIds.includes(c.id));
}

export async function createCard(actor: ExpenseViewer, input: CardInput) {
  requireCore(canManageCards(actor));
  const data = cleanCard(input) as CardInput;
  if (!data.nickname || !data.last4 || !data.ownerId) throw new ExpenseError("invalid", "Nickname, last four and owner are required.");
  await assertStaffOwner(data.ownerId);
  await assertHolders(data);
  await assertCategoryExists(data.defaultCategoryId);
  const card = await prisma.expenseCard.create({
    data: {
      nickname: data.nickname,
      last4: data.last4,
      ownerId: data.ownerId,
      holderIds: data.holderIds ?? [],
      holderGroupIds: data.holderGroupIds ?? [],
      defaultCategoryId: data.defaultCategoryId ?? null,
    },
    select: CARD_SELECT,
  });
  await auditExpense(actor, "expense.card.create", card.id, {
    nickname: card.nickname,
    last4: card.last4,
    ownerId: card.ownerId,
    holderIds: card.holderIds,
    holderGroupIds: card.holderGroupIds,
  });
  return card;
}

export async function updateCard(actor: ExpenseViewer, id: string, input: Partial<CardInput>) {
  requireCore(canManageCards(actor));
  const data = cleanCard(input);
  if (data.ownerId) await assertStaffOwner(data.ownerId);
  await assertHolders(data);
  await assertCategoryExists(data.defaultCategoryId);
  try {
    const card = await prisma.expenseCard.update({ where: { id }, data, select: CARD_SELECT });
    await auditExpense(actor, "expense.card.update", id, {
      fields: Object.keys(data),
      ownerId: card.ownerId,
      holderIds: card.holderIds,
      holderGroupIds: card.holderGroupIds,
    });
    return card;
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") throw new ExpenseError("not_found", "Card not found.");
    throw e;
  }
}

export type ArchiveCardResult =
  | { archived: true }
  | { archived: false; needsConfirm: true; submittedCount: number };

export async function archiveCard(actor: ExpenseViewer, id: string, opts: { confirm?: boolean } = {}): Promise<ArchiveCardResult> {
  requireCore(canManageCards(actor));
  const submittedCount = await prisma.expense.count({ where: { cardId: id, status: "SUBMITTED" } });
  if (submittedCount > 0 && !opts.confirm) return { archived: false, needsConfirm: true, submittedCount };
  const r = await prisma.expenseCard.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } });
  if (r.count === 0) {
    const exists = await prisma.expenseCard.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new ExpenseError("not_found", "Card not found.");
  }
  await auditExpense(actor, "expense.card.archive", id, { submittedCount });
  return { archived: true };
}
