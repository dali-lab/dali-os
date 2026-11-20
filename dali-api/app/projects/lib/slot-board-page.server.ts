import { redirect } from "react-router";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseFormDataJson } from "~/lib/safe-json";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { resolveTermFilter } from "~/lib/terms";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import {
  getSlotBinding,
  isGateAudience,
  listSelectableForms,
  setSlotBinding,
  setSlotColumnMapping,
  setSlotGate,
  setSlotPublished,
  type Slot,
} from "~/projects/lib/form-slots";
import {
  parseColumnMapping,
  validateMapping,
  boardTableModel,
  type ColumnMapping,
} from "~/projects/lib/slot-roles";
import { buildSubmissionView, type ResolvedRow } from "~/projects/lib/submission-view.server";
import { deleteBoardResponse, resolveBoardCycles, setBoardColumn } from "~/projects/lib/slot-board.server";
import { OPEN_PARAM } from "~/projects/lib/board-filters";
import type { Question } from "~/types";
import { conditionalKeys } from "~/forms/lib/form-logic";

type Binding = Awaited<ReturnType<typeof getSlotBinding>>;

export type SlotBoardRowsContext = { cycleIds: string[]; binding: Binding };

export async function loadSlotBoard<Row extends ResolvedRow = ResolvedRow>(
  request: Request,
  slot: Slot,
  opts: {
    withTermColumns?: boolean;
    enrichRows?: (rows: ResolvedRow[], ctx: SlotBoardRowsContext) => Promise<Row[]>;
  } = {},
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const cycles = await resolveBoardCycles(request, { create: true });
  if (!cycles) return { gate: "no-cycle" as const };
  const { termOptions, selectedTerm, isAll, cycleIds, cycleName, singleCycleId } = cycles;

  const canManage = await canManageStaffing(auth.user.sub);
  const [binding, selectableForms] = await Promise.all([
    singleCycleId ? getSlotBinding(singleCycleId, slot) : Promise.resolve(null),
    canManage && singleCycleId
      ? listSelectableForms({ slot, exceptCycleId: singleCycleId })
      : Promise.resolve([]),
  ]);

  const noFormConnected = !isAll && !binding;

  const view = await buildSubmissionView({
    cycleIds,
    slot,
    formId: binding?.formId ?? null,
  });
  const submissions = opts.enrichRows
    ? await opts.enrichRows(view.rows, { cycleIds, binding })
    : (view.rows as Row[]);

  let formQuestions: {
    key: string;
    label: string;
    type: string;
    referenceSource?: string;
    options?: string[];
  }[] = [];
  let mappingWarning: string | null = null;
  if (binding) {
    const latest = await prisma.formVersion.findFirst({
      where: { form: { id: binding.formId } },
      orderBy: { versionNumber: "desc" },
      select: { questions: true },
    });
    const qs = (latest?.questions as unknown as Question[]) ?? [];
    const conditional = conditionalKeys(qs);
    formQuestions = qs.filter((q) => !conditional.has(q.key)).map((q) => ({
      key: q.key,
      label: q.data.label,
      type: q.type,
      referenceSource: q.data.referenceSource,
      options: q.data.options,
    }));
    const check = validateMapping(slot, qs, binding.mapping);
    if (!check.ok) mappingWarning = check.reason;
  }

  const allTerms = opts.withTermColumns
    ? await prisma.term.findMany({
        orderBy: { sortKey: "desc" },
        select: { id: true, code: true },
      })
    : [];

  const mappedTermIds = new Set(binding?.mapping?.entries.flatMap((e) => e.termId ?? []) ?? []);
  const columnModel = boardTableModel(
    slot,
    binding?.mapping ?? null,
    view.tableColumns,
    formQuestions,
    allTerms.filter((t, i) => i < 4 || mappedTermIds.has(t.id)),
  );

  const domainOptions = await prisma.domain.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });

  return {
    gate: "ok" as const,
    cycle: { name: cycleName, id: singleCycleId },
    termOptions,
    selectedTerm,
    domainOptions,
    isAll,
    submissions,
    tableColumns: columnModel.columns,
    addableColumns: columnModel.addable,
    roleChoices: columnModel.roleChoices,
    canManage,
    binding,
    selectableForms,
    noFormConnected,
    formQuestions,
    mappingWarning,
    allTerms,
  };
}

export type SlotBoardData<Row extends ResolvedRow = ResolvedRow> = Extract<
  Awaited<ReturnType<typeof loadSlotBoard<Row>>>,
  { gate: "ok" }
>;

export type SlotBoardLoad<Row extends ResolvedRow = ResolvedRow> = Awaited<
  ReturnType<typeof loadSlotBoard<Row>>
>;

const SETTINGS_INTENTS = new Set([
  "set-slot-form",
  "set-slot-mapping",
  "set-slot-gate",
  "set-slot-published",
  "set-slot-column",
  "delete-response",
]);

const isSlotBoardIntent = (intent: string) => SETTINGS_INTENTS.has(intent);

async function resolveActionCycle(request: Request) {
  const { terms: termOptions, termId: filterTermId } = await resolveTermFilter(request);
  const fallbackTerm = await currentTerm();
  const selected =
    termOptions.find((o) => o.id === filterTermId) ??
    (fallbackTerm ? { id: fallbackTerm.id, code: fallbackTerm.code } : termOptions[0]);
  if (!selected) return null;
  return ensureStaffingCycle(selected.id, selected.code);
}

type IntentCtx = {
  request: Request;
  form: FormData;
  cycleId: string;
  slot: Slot;
  userId: string;
  onMappingSaved?: (cycleId: string, mapping: ColumnMapping) => Promise<Record<string, unknown>>;
};

async function runSlotBoardIntent(intent: string, ctx: IntentCtx): Promise<Response | null> {
  const { request, form, cycleId, slot, userId } = ctx;

  if (intent === "set-slot-form") {
    const formId = String(form.get("formId") ?? "");
    const result = await setSlotBinding(cycleId, slot, formId, userId, {
      allowMove: form.get("allowMove") === "1",
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true, movedFrom: result.movedFrom ?? null });
  }

  if (intent === "set-slot-mapping") {
    const binding = await getSlotBinding(cycleId, slot);
    if (!binding) {
      return Response.json({ error: "Bind a form before mapping its columns." }, { status: 400 });
    }
    const mapping = parseColumnMapping(parseFormDataJson(form.get("mapping")));
    if (!mapping) return Response.json({ error: "Invalid mapping." }, { status: 400 });
    const latest = await prisma.formVersion.findFirst({
      where: { form: { id: binding.formId } },
      orderBy: { versionNumber: "desc" },
      select: { questions: true },
    });
    const qs = (latest?.questions as unknown as Question[]) ?? [];
    const check = validateMapping(slot, qs, mapping);
    if (!check.ok) return Response.json({ error: check.reason }, { status: 400 });
    const result = await setSlotColumnMapping(cycleId, slot, mapping as ColumnMapping, userId);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    const extra = ctx.onMappingSaved ? await ctx.onMappingSaved(cycleId, mapping as ColumnMapping) : {};
    return Response.json({ ok: true, ...extra });
  }

  if (intent === "set-slot-column") return setBoardColumn(form, cycleId, slot, userId);

  if (intent === "delete-response") return deleteBoardResponse(form, cycleId, slot, userId, request);

  if (intent === "set-slot-gate") {
    const raw = String(form.get("gateAudience") ?? "");
    const audience = raw === "" ? null : raw;
    if (audience !== null && !isGateAudience(audience)) {
      return Response.json({ error: "Invalid audience." }, { status: 400 });
    }
    const result = await setSlotGate(cycleId, slot, audience, null, userId);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  }

  if (intent === "set-slot-published") {
    const result = await setSlotPublished(cycleId, slot, form.get("published") === "1");
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  }

  return null;
}

export async function slotBoardAction(
  request: Request,
  slot: Slot,
  opts: {
    managersOnly?: boolean;
    onMappingSaved?: IntentCtx["onMappingSaved"];
    extraIntent?: (intent: string, ctx: { form: FormData; userId: string }) => Promise<Response | null>;
  } = {},
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;

  const forbidden = async () =>
    (await canManageStaffing(userId)) ? null : Response.json({ error: "Forbidden" }, { status: 403 });

  if (opts.managersOnly) {
    const denied = await forbidden();
    if (denied) return denied;
  }

  const cycle = await resolveActionCycle(request);
  if (!cycle) return Response.json({ error: "No active staffing term." }, { status: 400 });
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (isSlotBoardIntent(intent)) {
    const denied = opts.managersOnly ? null : await forbidden();
    if (denied) return denied;
    const ran = await runSlotBoardIntent(intent, {
      request,
      form,
      cycleId: cycle.id,
      slot,
      userId,
      onMappingSaved: opts.onMappingSaved,
    });
    if (ran) return ran;
  }

  const extra = await opts.extraIntent?.(intent, { form, userId });
  if (extra) return extra;
  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export async function redirectToBoardDetail(request: Request, slot: Slot, userId: string) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");
  const query = new URL(request.url).searchParams;
  query.set(OPEN_PARAM, userId);
  return redirect(`/core/${slot}?${query}`);
}
