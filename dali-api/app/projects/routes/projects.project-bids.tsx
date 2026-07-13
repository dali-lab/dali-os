import { useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.project-bids";
import { useFilteredList } from "~/hooks/useFilteredList";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { parseFormDataJson } from "~/lib/safe-json";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import {
  getSlotBinding,
  listSelectableForms,
  setSlotBinding,
  setSlotColumnMapping,
} from "../lib/form-slots";
import { SubmissionFilters } from "../components/SubmissionFilters";
import { SlotAdvancedSettingsModal } from "../components/SlotAdvancedSettingsModal";
import { SubmissionDatabase } from "../components/SubmissionDatabase";
import { DomainFilter } from "../components/DomainFilter";
import { TermFilter } from "~/components/TermFilter";
import { resolveTermFilter } from "~/lib/terms";
import {
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
} from "../lib/slot-roles";
import { buildSubmissionView } from "../lib/submission-view.server";
import { deriveSlotStatus, type SlotStatus } from "../lib/slot-status.server";
import { SlotStatusStrip } from "../components/SlotStatusStrip";
import { projectsPills } from "../components/projectsPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import type { Question } from "~/types";

const SLOT = "project-bids" as const;

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Project Bids · DALI OS" },
];

// Read-only database of received Project Bid submissions for the current
// cycle. Core/Admin only. Members fill whichever generic form a staffing
// manager bound to this cycle's "project-bids" slot (see form-slots).
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const {
    terms: termOptions,
    selected: selectedTerm,
    termId: filterTermId,
    isAll,
  } = await resolveTermFilter(request);

  const fallbackTerm = await currentTerm();
  if (!fallbackTerm && termOptions.length === 0)
    return { gate: "no-cycle" as const };

  // Which staffing cycle(s) feed the board:
  //  - All terms → every existing cycle (read-only aggregate; don't create).
  //  - A specific term (default = current) → that term's cycle, get-or-create
  //    so the live cycle keeps its existing auto-provision behavior.
  let cycleIds: string[];
  let cycleName: string;
  let singleCycleId: string | null;
  if (isAll) {
    const cycles = await prisma.staffingCycle.findMany({
      select: { id: true },
    });
    cycleIds = cycles.map((c) => c.id);
    cycleName = "all terms";
    singleCycleId = null;
  } else {
    const t =
      termOptions.find((o) => o.id === filterTermId) ??
      (fallbackTerm
        ? { id: fallbackTerm.id, code: fallbackTerm.code }
        : termOptions[0]);
    const cycle = await ensureStaffingCycle(t.id, t.code);
    cycleIds = [cycle.id];
    cycleName = cycle.name;
    singleCycleId = cycle.id;
  }

  // The generic-form slot binding is per-cycle, so it only applies to the
  // single-term view. In the all-terms aggregate there's no one slot to bind,
  // so the picker is hidden (singleCycleId === null).
  const canManage = await canManageStaffing(auth.user.sub);
  const [binding, selectableForms] = await Promise.all([
    singleCycleId ? getSlotBinding(singleCycleId, SLOT) : Promise.resolve(null),
    canManage && singleCycleId
      ? listSelectableForms()
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
  const tableColumns = view.tableColumns.map((c) => ({
    key: c.key,
    label: c.label,
  }));

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
    formQuestions = qs.map((q) => ({
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

  const domainOptions = await prisma.domain.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });

  // Per-slot guardrail status (bound / mapped / sent-to). Single-cycle view
  // only — the all-terms aggregate has no one slot to bind, mirroring binding.
  const slotStatus: SlotStatus | null = singleCycleId
    ? (await deriveSlotStatus(singleCycleId)).find((s) => s.slot === SLOT) ??
      null
    : null;

  return {
    gate: "ok" as const,
    cycle: { name: cycleName },
    termOptions,
    selectedTerm,
    isAll,
    submissions,
    tableColumns,
    canManage,
    binding,
    selectableForms,
    formQuestions,
    mappingWarning,
    noFormConnected,
    domainOptions,
    slotStatus,
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
    const result = await setSlotBinding(cycle.id, SLOT, formId, auth.user.sub);
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
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
  const [domainId, setDomainId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { search, setSearch, filtered } = useFilteredList(data.submissions, {
    searchFields: (s) => [s.name, s.email],
    predicates: [(s) => !domainId || s.domainIds.includes(domainId)],
    deps: [domainId],
  });

  const domains = useMemo(
    () => data.domainOptions.map((d) => ({ id: d.id, name: d.displayName })),
    [data.domainOptions],
  );

  // The form/columns settings only make sense per-cycle; the all-terms
  // aggregate has no single binding to edit, so the trigger is hidden there.
  const canOpenSettings = !data.isAll;

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

      {data.mappingWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-medium">Heads up:</span> {data.mappingWarning}{" "}
          Submissions are still recorded; affected columns just won’t feed
          staffing until you fix the mapping.
        </div>
      )}

      {data.slotStatus && <SlotStatusStrip status={data.slotStatus} />}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SubmissionFilters query={search} onQueryChange={setSearch} />
        </div>
        <DomainFilter
          domains={domains}
          value={domainId}
          onChange={setDomainId}
        />
        <TermFilter terms={data.termOptions} selected={data.selectedTerm} />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {data.noFormConnected ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Project Bids form is connected for this term. Open{" "}
            <em>Advanced settings</em> to connect one so members can submit
            bids — bids only exist through the form.
          </div>
        ) : (
          <SubmissionDatabase
            columns={data.tableColumns}
            rows={filtered}
            // Carry the viewed term through to the detail page. Without it the
            // detail loader falls back to currentTerm(), so a bid opened from
            // 26X would load 26S. selectedTerm is a term id (or the ALL_TERMS
            // sentinel, which the detail loader resolves the same way).
            detailBase={`/projects/project-bids?term=${encodeURIComponent(data.selectedTerm)}`}
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
  return (
    <>
    <AreaPillNav items={projectsPills({ canViewStaffing: true, active: "bids" })} />
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Project Bids
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Received bid submissions{cycleName ? ` for ${cycleName}` : ""}.
        </p>
      </div>
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted"
        >
          {settingsLabel ?? "Advanced settings"}
        </button>
      )}
    </header>
    </>
  );
}
