import { useMemo, useState } from "react";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/core.project-bids";
import { coreHandle } from "~/core/coreNav";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { useFilteredList } from "~/hooks/useFilteredList";
import { useSearchParamState } from "~/hooks/useSearchParamState";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseFormDataJson } from "~/lib/safe-json";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import {
  getSlotBinding,
  isGateAudience,
  listSelectableForms,
  setSlotBinding,
  setSlotColumnMapping,
  setSlotGate,
  setSlotPublished,
} from "~/projects/lib/form-slots";
import { ColumnFilters, useColumnFilters } from "~/projects/components/ColumnFilters";
import { SlotAdvancedSettingsModal } from "~/projects/components/SlotAdvancedSettingsModal";
import { SubmissionDatabase } from "~/projects/components/SubmissionDatabase";
import { BoardCsvLink, BoardTable } from "~/projects/components/BoardTable";
import { BoardSettings } from "~/projects/components/BoardSettings";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { SearchInput } from "~/components/ui/SearchInput";
import { TermFilter } from "~/components/TermFilter";
import { DomainFilter } from "~/projects/components/DomainFilter";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { resolveTermFilter } from "~/lib/terms";
import {
  parseColumnMapping,
  validateMapping,
  boardTableModel,
  type ColumnMapping,
} from "~/projects/lib/slot-roles";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { resolveBoardCycles, setBoardColumn } from "~/projects/lib/slot-board.server";
import type { Question } from "~/types";
import { conditionalKeys } from "~/forms/lib/form-logic";

const SLOT = "project-bids" as const;


export const handle = coreHandle("project-bids");

export const meta: Route.MetaFunction = () => [
  { title: "Project Bids · DALI OS" },
];

// Read-only database of received Project Bid submissions for the current
// cycle. Core/Admin only. Members fill whichever generic form a staffing
// manager bound to this cycle's "project-bids" slot (see form-slots).
// Search, domain and column filters live in the URL but filter client side;
// only the term changes what the loader reads.
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, ["term"]);
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const cycles = await resolveBoardCycles(request, { create: true });
  if (!cycles) return { gate: "no-cycle" as const };
  const { termOptions, selectedTerm, isAll, cycleIds, cycleName, singleCycleId } = cycles;

  // The generic-form slot binding is per-cycle, so it only applies to the
  // single-term view. In the all-terms aggregate there's no one slot to bind,
  // so the picker is hidden (singleCycleId === null).
  const canManage = await canManageStaffing(auth.user.sub);
  const [binding, selectableForms] = await Promise.all([
    singleCycleId ? getSlotBinding(singleCycleId, SLOT) : Promise.resolve(null),
    canManage && singleCycleId
      ? listSelectableForms({ slot: SLOT, exceptCycleId: singleCycleId })
      : Promise.resolve([]),
  ]);

  // The board is a database view of the raw submissions: every member who
  // submitted the bound form shows here, with whatever columns the manager
  // configured (order/visibility from the saved mapping). StaffingPreference
  // is still written by the submit path when project/domain columns are
  // mapped, but the table reads submissions so partial/zero mappings still
  // show the data.
  const view = await buildSubmissionView({
    cycleIds,
    slot: SLOT,
    formId: binding?.formId ?? null,
  });
  const submissions = view.rows;

  // The bound form's latest-version questions drive the column mapper, and
  // validating the saved mapping against them warns a manager (before any
  // member submits) that the mapping is missing/stale.
  let formQuestions: {
    key: string;
    label: string;
    type: string;
    referenceSource?: string;
  }[] = [];
  // Submissions always record now; a mapping problem only means some columns
  // can't feed staffing / can't render. Surface it as advisory, not a block.
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
    }));
    const check = validateMapping("project-bids", qs, binding.mapping);
    if (!check.ok) mappingWarning = check.reason;
  }

  // No form bound to this single cycle ⇒ there can be no submissions; the
  // page says so explicitly instead of rendering an empty/!misleading table.
  // (The all-terms aggregate has no single slot to bind, so it's exempt.)
  const noFormConnected = !isAll && !binding;

  const columnModel = boardTableModel(
    SLOT,
    binding?.mapping ?? null,
    view.tableColumns,
    formQuestions,
    [],
  );

  const domainOptions = await prisma.domain.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });

  return {
    gate: "ok" as const,
    cycle: { name: cycleName },
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
    formQuestions,
    mappingWarning,
    noFormConnected,
  };
}

// Staffing managers bind a generic form to this cycle's Project Bids slot.
// Gated tighter than the loader: viewing the board is Core/Admin, changing
// the form requires staffing management.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canManageStaffing(auth.user.sub)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  // Bind to the cycle for the term the page is VIEWING (?term=), not whatever
  // term is live today — the loader resolves the cycle the same way, so a
  // binding saved while viewing 26X must land on 26X, else the picker reloads
  // empty and the save looks lost. Falls back to the current term when no term
  // is selected.
  const { terms: termOptions, termId: filterTermId } =
    await resolveTermFilter(request);
  const fallbackTerm = await currentTerm();
  const selected =
    termOptions.find((o) => o.id === filterTermId) ??
    (fallbackTerm
      ? { id: fallbackTerm.id, code: fallbackTerm.code }
      : termOptions[0]);
  if (!selected)
    return Response.json({ error: "No active staffing term." }, { status: 400 });
  const cycle = await ensureStaffingCycle(selected.id, selected.code);

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "set-slot-form") {
    const formId = String(form.get("formId") ?? "");
    // The picker sets allowMove only after the manager confirms taking the
    // form off the cycle that currently holds it.
    const result = await setSlotBinding(cycle.id, SLOT, formId, auth.user.sub, {
      allowMove: form.get("allowMove") === "1",
    });
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true, movedFrom: result.movedFrom ?? null });
  }

  if (intent === "set-slot-mapping") {
    const binding = await getSlotBinding(cycle.id, SLOT);
    if (!binding)
      return Response.json(
        { error: "Bind a form before mapping its columns." },
        { status: 400 },
      );
    const mapping = parseColumnMapping(parseFormDataJson(form.get("mapping")));
    if (!mapping)
      return Response.json({ error: "Invalid mapping." }, { status: 400 });
    // Validate against the bound form's current questions before saving.
    const latest = await prisma.formVersion.findFirst({
      where: { form: { id: binding.formId } },
      orderBy: { versionNumber: "desc" },
      select: { questions: true },
    });
    const qs = (latest?.questions as unknown as Question[]) ?? [];
    const check = validateMapping(SLOT, qs, mapping);
    if (!check.ok)
      return Response.json({ error: check.reason }, { status: 400 });
    const result = await setSlotColumnMapping(
      cycle.id,
      SLOT,
      mapping as ColumnMapping,
      auth.user.sub,
    );
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  }

  if (intent === "set-slot-column")
    return setBoardColumn(form, cycle.id, SLOT, auth.user.sub, request);

  if (intent === "set-slot-gate") {
    const raw = String(form.get("gateAudience") ?? "");
    const audience = raw === "" ? null : raw;
    if (audience !== null && !isGateAudience(audience))
      return Response.json({ error: "Invalid audience." }, { status: 400 });
    const result = await setSlotGate(cycle.id, SLOT, audience, null, auth.user.sub);
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  }

  if (intent === "set-slot-published") {
    const result = await setSlotPublished(
      cycle.id,
      SLOT,
      form.get("published") === "1",
    );
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export default function ProjectBidsDatabase() {
  const data = useLoaderData<typeof loader>();

  if (data.gate === "no-cycle") {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <p className="text-sm text-muted-foreground">
          No active staffing term right now.
        </p>
      </div>
    );
  }

  return <Loaded data={data} />;
}

function Loaded({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof loader>>, { gate: "ok" }>;
}) {
  const [searchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(
    () => searchParams.get("settings") === "1",
  );

  const [domainId, setDomainId] = useSearchParamState("domain");
  const [search, setSearch] = useSearchParamState("q", { debounceMs: 300 });
  const columnFilters = useColumnFilters(data.tableColumns, [], { inUrl: true });
  const responseTable = useFeatureFlag("form-response-views");

  const { filtered } = useFilteredList(data.submissions, {
    search,
    searchFields: (s) => [s.name, s.email],
    predicates: [
      (s) => !domainId || s.domainIds.includes(domainId),
      columnFilters.predicate,
    ],
    deps: [domainId, columnFilters.active],
  });

  const domains = useMemo(
    () => data.domainOptions.map((d) => ({ id: d.id, name: d.displayName })),
    [data.domainOptions],
  );

  // The form/columns settings only make sense per-cycle; the all-terms
  // aggregate has no single binding to edit, so the trigger is hidden there.
  const canOpenSettings = !data.isAll && !responseTable;

  return (
    <div className="flex flex-col gap-4">
      <Header
        cycleName={data.cycle.name}
        onOpenSettings={
          canOpenSettings ? () => setSettingsOpen(true) : undefined
        }
        settingsLabel={data.canManage ? "Advanced settings" : "View settings"}
      />

      {canOpenSettings && (
        <SlotAdvancedSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          slot="project-bids"
          slotLabel="Project Bids"
          binding={data.binding}
          selectableForms={data.selectableForms}
          formQuestions={data.formQuestions}
          cycleTerms={[]}
          canManage={data.canManage}
        />
      )}

      {responseTable && !data.isAll && (
        <BoardSettings
          slotLabel="Project Bids"
          binding={data.binding}
          forms={data.selectableForms}
          canManage={data.canManage}
        />
      )}

      {data.mappingWarning && (
        <div className="rounded-md border border-os-amber/40 bg-os-amber/10 px-3 py-2 text-sm text-os-amber">
          <span className="font-medium">Heads up:</span> {data.mappingWarning}{" "}
          Submissions are still recorded; affected columns just won’t feed
          staffing until you fix the mapping.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search submissions"
          containerClassName="flex-1 min-w-[200px] max-w-[420px]"
        />
        <TermFilter terms={data.termOptions} selected={data.selectedTerm} />
        <DomainFilter domains={domains} value={domainId} onChange={setDomainId} />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={data.tableColumns}
            rows={data.submissions}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={filtered.length}
          />
        </div>
        {responseTable && !data.noFormConnected && (
          <BoardCsvLink slot={SLOT} matching={filtered.length} total={data.submissions.length} />
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {data.noFormConnected && responseTable ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Connect a form from the ⋯ menu above so members can submit.
          </div>
        ) : data.noFormConnected ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Project Bids form is connected for this term. Open{" "}
            <em>Advanced settings</em> to connect one so members can submit
            bids — bids only exist through the form.
          </div>
        ) : responseTable ? (
          <BoardTable
            columns={data.tableColumns}
            addable={data.addableColumns}
            roleChoices={data.roleChoices}
            rows={filtered}
            editable={data.canManage && !data.isAll}
            emptyMessage={
              data.submissions.length === 0
                ? "No bid submissions yet."
                : "No members match the current filters."
            }
          />
        ) : (
          <SubmissionDatabase
            columns={data.tableColumns}
            rows={filtered}
            // Carry the viewed term through to the detail page. Without it the
            // detail loader falls back to currentTerm(), so a bid opened from
            // 26X would load 26S. selectedTerm is a term id (or the ALL_TERMS
            // sentinel, which the detail loader resolves the same way).
            detailBase={`/core/project-bids?term=${encodeURIComponent(data.selectedTerm)}`}
            emptyMessage={
              data.submissions.length === 0
                ? "No bid submissions yet."
                : "No members match the current filters."
            }
          />
        )}
      </div>
    </div>
  );
}

function Header({
  cycleName,
  onOpenSettings,
  settingsLabel,
}: {
  cycleName?: string;
  onOpenSettings?: () => void;
  settingsLabel?: string;
}) {
  const { pageTitle } = useOsChrome();
  return (
    <>
    <header className="flex items-start justify-between gap-3">
      <h1 className={pageTitle}>Project Bids</h1>
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className={cn(
            "shrink-0",
            "os-edit-btn",
          )}
        >
          {settingsLabel ?? "Advanced settings"}
        </button>
      )}
    </header>
    </>
  );
}
