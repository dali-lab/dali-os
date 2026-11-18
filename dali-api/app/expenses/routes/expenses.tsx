import { useLoaderData } from "react-router";
import type { Route } from "./+types/expenses";
import { prisma } from "~/lib/db.server";
import { ExpensesPage } from "../components/ExpensesPage";
import type { ActionResult, CardOption, CategoryOption, ChargeRow, ExpenseRow, ExpenseView, GroupRow, PersonRow } from "../components/types";
import { toExpenseRow, toExpenseView } from "../components/view";
import { listAllGroups } from "~/lib/groups.server";
import { orderGroupsForPicker } from "~/lib/group-kind";
import { canFileOnCard, expenseTabs, isCardHolderGroup, type ExpenseViewer } from "../lib/access";
import { CARD_HOLDER_WHERE } from "../lib/cards.server";
import { ExpenseError } from "../lib/errors";
import {
  archiveCard,
  archiveCategory,
  createCard,
  createCategory,
  createFromReceipts,
  createNoReceipt,
  decideExpense,
  deleteDraft,
  getExpense,
  importStatement,
  listCards,
  listCategories,
  listCharges,
  listExpenses,
  markPaid,
  matchCharge,
  submitExpense,
  unmatchCharge,
  updateCard,
  updateCategory,
  updateExpense,
  withdrawExpense,
  type ChargeState,
  type UpdateExpenseInput,
} from "../lib/expenses.server";
import { getChargeForFiling } from "../lib/charge-filing.server";
import { parseMoneyToCents } from "../lib/money";
import { requestReceipt } from "../lib/reminders.server";
import { parseExpenseFilters } from "./filters";
import { failure, guardExpenses } from "./guard.server";

export const meta: Route.MetaFunction = () => [{ title: "Expenses · DALI OS" }];

export const handle = { breadcrumb: () => "Expenses" };

const TABS = ["yours", "approvals", "all", "cards"] as const;
export type ExpensesTab = (typeof TABS)[number];

const CHARGE_FILTERS: Record<string, ChargeState> = { needs: "needs_receipt", matched: "matched" };

function notFound(e: unknown): never {
  if (e instanceof ExpenseError) throw new Response("Not found", { status: 404 });
  throw e;
}

const person = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

function toCardOption(c: Awaited<ReturnType<typeof listCards>>[number]): CardOption {
  return {
    id: c.id,
    nickname: c.nickname,
    last4: c.last4,
    ownerId: c.ownerId,
    ownerName: person(c.owner),
    holderIds: c.holderIds,
    holderGroupIds: c.holderGroupIds,
    defaultCategoryId: c.defaultCategoryId,
    archived: c.archivedAt !== null,
  };
}

function toCategoryOption(c: Awaited<ReturnType<typeof listCategories>>[number]): CategoryOption {
  return { id: c.id, label: c.label, chartString: c.chartString, hints: c.hints, archived: c.archivedAt !== null };
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, person(u)]));
}

async function loadExpenseParam(viewer: ExpenseViewer, id: string | null): Promise<ExpenseView | null> {
  if (!id) return null;
  try {
    return toExpenseView(await getExpense(viewer, id));
  } catch (e) {
    if (e instanceof ExpenseError) return null;
    throw e;
  }
}

async function loadCardsTab(viewer: ExpenseViewer, params: URLSearchParams, cards: CardOption[], request: Request) {
  const visible = cards.filter((c) => viewer.isCore || viewer.ownedCardIds.includes(c.id));
  const requested = params.get("card");
  const selected = visible.find((c) => c.id === requested) ?? visible.find((c) => !c.archived) ?? visible[0] ?? null;
  const chargeFilter = params.get("charges") === "needs" || params.get("charges") === "matched" ? (params.get("charges") as string) : "all";

  let charges: ChargeRow[] = [];
  let candidates: ExpenseRow[] = [];
  if (selected) {
    const rows = await listCharges(viewer, selected.id, { state: CHARGE_FILTERS[chargeFilter] });
    const names = await namesFor(rows.flatMap((r) => (r.expense ? [r.expense.submitterId] : [])));
    charges = rows.map((r) => ({
      id: r.id,
      postedAt: r.postedAt.toISOString().slice(0, 10),
      merchant: r.merchant,
      amountCents: r.amountCents,
      state: r.state,
      expenseId: r.expense?.id ?? null,
      expenseMerchant: r.expense?.merchant ?? null,
      filedBy: r.expense ? (names.get(r.expense.submitterId) ?? null) : null,
    }));
    const approved = await listExpenses(viewer, viewer.isStaff || viewer.isCore ? "all" : "approvals", {
      status: ["APPROVED"],
      cardId: selected.id,
    });
    candidates = approved.filter((e) => !e.matched && e.paidWith === "STAFF_CARD").map(toExpenseRow);
  }

  const [people, allGroups] = viewer.isCore
    ? await Promise.all([
        prisma.user.findMany({
          where: CARD_HOLDER_WHERE,
          select: { id: true, firstName: true, lastName: true, adminMembership: { select: { isStaff: true } } },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        }),
        listAllGroups(request),
      ])
    : [[], []];
  const members: PersonRow[] = people.map((u) => ({ id: u.id, name: person(u) }));
  const staff: PersonRow[] = people.filter((u) => u.adminMembership?.isStaff).map((u) => ({ id: u.id, name: person(u) }));
  const groups: GroupRow[] = orderGroupsForPicker(allGroups.filter((g) => !g.archived && isCardHolderGroup(g))).map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberIds.length,
  }));
  return { cards: visible, selectedCardId: selected?.id ?? null, chargeFilter, charges, candidates, members, staff, groups };
}

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await guardExpenses(request, { write: false, page: true });
  if (!guard.ok) throw guard.response;
  const { viewer } = guard;
  const params = new URL(request.url).searchParams;
  const tabs = expenseTabs(viewer);

  const rawTab = params.get("tab") ?? "yours";
  const tab: ExpensesTab = (TABS as readonly string[]).includes(rawTab) ? (rawTab as ExpensesTab) : "yours";
  if (!tabs[tab]) throw new Response("Not found", { status: 404 });

  const [cardRows, categoryRows] = await Promise.all([
    listCards(viewer, { includeArchived: tab === "cards" || tab === "all" }),
    listCategories({ includeArchived: tab === "cards" || tab === "all" }),
  ]);
  const allCards = cardRows.map(toCardOption);
  const categories = categoryRows.map(toCategoryOption);
  const fileableCards = allCards.filter((c) => canFileOnCard(viewer, { ...c, archivedAt: c.archived ? new Date() : null }));

  const scope = tab === "approvals" ? "approvals" : tab === "all" ? "all" : "mine";
  const filters = tab === "all" ? parseExpenseFilters(params) : {};
  const rows = tab === "cards" ? [] : (await listExpenses(viewer, scope, filters)).map(toExpenseRow);

  const chargeId = params.get("charge");
  const [expense, charge] = await Promise.all([
    loadExpenseParam(viewer, params.get("expense") ?? (tab === "approvals" ? (rows[0]?.id ?? null) : null)),
    chargeId ? getChargeForFiling(viewer, chargeId).catch(notFound) : null,
  ]);

  const terms =
    tab === "all"
      ? (await prisma.term.findMany({ select: { id: true, code: true }, orderBy: { sortKey: "desc" } }))
      : [];

  return {
    viewer: { userId: viewer.userId, isCore: viewer.isCore, isStaff: viewer.isStaff, ownedCardIds: [...viewer.ownedCardIds] },
    tabs,
    tab,
    rows,
    expense,
    charge,
    fileableCards,
    allCards: tab === "all" ? allCards : [],
    categories,
    terms,
    cardsTab: tab === "cards" ? await loadCardsTab(viewer, params, allCards, request) : null,
  };
}

export type ExpensesLoaderData = Awaited<ReturnType<typeof loader>>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;

function parseJson<T>(form: FormData, key: string, fallback: T): T {
  const raw = form.get(key);
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ExpenseError("invalid", "That request wasn't understood.");
  }
}

type RawPatch = Record<string, unknown>;

export function toUpdateInput(raw: RawPatch): UpdateExpenseInput {
  const out: UpdateExpenseInput = {};
  const str = (k: string) => (raw[k] === null ? null : typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  if ("merchant" in raw) out.merchant = str("merchant");
  if ("purpose" in raw) out.purpose = str("purpose");
  if ("categoryId" in raw) out.categoryId = str("categoryId") || null;
  if ("noReceiptReason" in raw) out.noReceiptReason = str("noReceiptReason");
  if ("cardId" in raw) out.cardId = str("cardId") || null;
  if ("paidWith" in raw) {
    if (raw.paidWith !== null && raw.paidWith !== "STAFF_CARD" && raw.paidWith !== "OWN_CARD") {
      throw new ExpenseError("invalid", "Choose how it was paid.");
    }
    out.paidWith = raw.paidWith as UpdateExpenseInput["paidWith"];
  }
  if ("purchasedAt" in raw) {
    const d = raw.purchasedAt;
    if (d !== null && d !== "" && !(typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      throw new ExpenseError("invalid", "That date isn't valid.");
    }
    out.purchasedAt = d ? (d as string) : null;
  }
  if ("amount" in raw) {
    const a = raw.amount;
    if (a === null || a === "") out.totalCents = null;
    else {
      const cents = parseMoneyToCents(typeof a === "string" || typeof a === "number" ? a : null);
      if (cents === null) throw new ExpenseError("invalid", "That amount isn't valid.");
      out.totalCents = cents;
    }
  }
  if (Array.isArray(raw.attendeeIds)) out.attendeeIds = raw.attendeeIds.filter((x): x is string => typeof x === "string");
  return out;
}

async function applyPatch(viewer: ExpenseViewer, id: string, form: FormData): Promise<void> {
  const patch = toUpdateInput(parseJson<RawPatch>(form, "patch", {}));
  if (Object.keys(patch).length > 0) await updateExpense(viewer, id, patch);
}

async function applyLastChoice(viewer: ExpenseViewer, id: string): Promise<void> {
  const last = await prisma.expense.findFirst({
    where: { submitterId: viewer.userId, paidWith: { not: null }, id: { not: id } },
    orderBy: { createdAt: "desc" },
    select: { paidWith: true, cardId: true },
  });
  if (!last?.paidWith) return;
  try {
    await updateExpense(viewer, id, { paidWith: last.paidWith, cardId: last.cardId });
  } catch (e) {
    if (!(e instanceof ExpenseError)) throw e;
  }
}

const ok = (body: Omit<Extract<ActionResult, { ok: true }>, "ok"> = {}) => Response.json({ ok: true, ...body });

function requireId(form: FormData, key = "id"): string {
  const id = text(form, key);
  if (!id) throw new ExpenseError("invalid", "That request wasn't understood.");
  return id;
}

async function run(viewer: ExpenseViewer, intent: string, form: FormData): Promise<Response> {
  switch (intent) {
    case "create": {
      const keys = parseJson<unknown[]>(form, "keys", []).filter((k): k is string => typeof k === "string");
      const cardId = optional(form, "cardId");
      const paidWith = optional(form, "paidWith");
      const created = await createFromReceipts(viewer, keys, {
        cardId,
        paidWith: paidWith === "STAFF_CARD" || paidWith === "OWN_CARD" ? paidWith : null,
      });
      if (!created.paidWith) await applyLastChoice(viewer, created.id);
      return ok({ expenseId: created.id });
    }
    case "create-no-receipt": {
      const paidWith = optional(form, "paidWith");
      const amount = optional(form, "amount");
      const cents = amount === null ? null : parseMoneyToCents(amount);
      if (amount !== null && cents === null) throw new ExpenseError("invalid", "That amount isn't valid.");
      const date = optional(form, "purchasedAt");
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ExpenseError("invalid", "That date isn't valid.");
      const created = await createNoReceipt(
        viewer,
        {
          merchant: optional(form, "merchant"),
          purchasedAt: date,
          totalCents: cents,
          purpose: optional(form, "purpose"),
          categoryId: optional(form, "categoryId"),
          paidWith: paidWith === "STAFF_CARD" || paidWith === "OWN_CARD" ? paidWith : null,
          cardId: optional(form, "cardId"),
        },
        text(form, "reason"),
        optional(form, "chargeId"),
      );
      return ok({ expenseId: created.id });
    }
    case "save": {
      const id = requireId(form);
      await applyPatch(viewer, id, form);
      return ok({ expenseId: id, message: "Saved." });
    }
    case "submit": {
      const id = requireId(form);
      await applyPatch(viewer, id, form);
      await submitExpense(viewer, id);
      return ok({ expenseId: id, message: "Submitted for approval." });
    }
    case "withdraw": {
      const id = requireId(form);
      await withdrawExpense(viewer, id);
      return ok({ expenseId: id, message: "Withdrawn. It's a draft again." });
    }
    case "delete": {
      await deleteDraft(viewer, requireId(form));
      return ok({ message: "Draft deleted." });
    }
    case "decide": {
      const id = requireId(form);
      const decision = text(form, "decision");
      if (decision !== "approve" && decision !== "return") throw new ExpenseError("invalid", "Approve or return the expense.");
      await applyPatch(viewer, id, form);
      await decideExpense(viewer, id, { decision, note: text(form, "note") });
      return ok({ expenseId: id, message: decision === "approve" ? "Approved." : "Returned with your note." });
    }
    case "mark-paid": {
      const id = requireId(form);
      await markPaid(viewer, id);
      return ok({ expenseId: id, message: "Marked as paid." });
    }
    case "card-save": {
      const id = optional(form, "id");
      const input = {
        nickname: text(form, "nickname"),
        last4: text(form, "last4"),
        ownerId: text(form, "ownerId"),
        holderIds: parseJson<unknown[]>(form, "holderIds", []).filter((h): h is string => typeof h === "string"),
        holderGroupIds: parseJson<unknown[]>(form, "holderGroupIds", []).filter((h): h is string => typeof h === "string"),
        defaultCategoryId: optional(form, "defaultCategoryId"),
      };
      if (id) await updateCard(viewer, id, input);
      else await createCard(viewer, input);
      return ok({ message: id ? "Card saved." : "Card added." });
    }
    case "card-archive": {
      const result = await archiveCard(viewer, requireId(form), { confirm: form.get("confirm") === "1" });
      if (!result.archived) {
        return Response.json({ ok: false, error: "This card has expenses waiting on approval.", needsConfirm: { submittedCount: result.submittedCount } } satisfies ActionResult, { status: 409 });
      }
      return ok({ archived: true, message: "Card archived." });
    }
    case "category-save": {
      const id = optional(form, "id");
      const input = {
        label: text(form, "label"),
        chartString: optional(form, "chartString"),
        hints: text(form, "hints").split(",").map((h) => h.trim()).filter(Boolean),
      };
      if (id) await updateCategory(viewer, id, input);
      else await createCategory(viewer, input);
      return ok({ message: id ? "Category saved." : "Category added." });
    }
    case "category-archive": {
      await archiveCategory(viewer, requireId(form));
      return ok({ message: "Category archived." });
    }
    case "import-statement": {
      const summary = await importStatement(viewer, requireId(form, "cardId"), String(form.get("csv") ?? ""), {
        date: text(form, "date"),
        merchant: text(form, "merchant"),
        amount: text(form, "amount"),
        invertSign: form.get("invertSign") === "1",
      });
      return ok({ summary });
    }
    case "match-charge": {
      await matchCharge(viewer, requireId(form, "expenseId"), requireId(form, "chargeId"));
      return ok({ message: "Matched." });
    }
    case "unmatch-charge": {
      await unmatchCharge(viewer, requireId(form, "expenseId"));
      return ok({ message: "Unmatched." });
    }
    case "request-receipt": {
      const { notified } = await requestReceipt(viewer, requireId(form, "chargeId"));
      return ok({ message: notified > 0 ? "Card holders were asked for a receipt." : "Card holders were asked recently." });
    }
    default:
      return Response.json({ ok: false, error: "Unknown request." }, { status: 400 });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const guard = await guardExpenses(request, { write: true, page: false });
  if (!guard.ok) return guard.response;
  const form = await request.formData();
  try {
    return await run(guard.viewer, text(form, "intent"), form);
  } catch (e) {
    return failure(e);
  }
}

export default function ExpensesRoute() {
  const data = useLoaderData<typeof loader>();
  return <ExpensesPage data={data} />;
}
