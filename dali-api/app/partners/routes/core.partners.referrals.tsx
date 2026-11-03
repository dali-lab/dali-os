import { useState } from "react";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/core.partners.referrals";
import { useFilteredList } from "~/hooks/useFilteredList";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseFormDataJson } from "~/lib/safe-json";
import { canManageStaffing, isCore, currentTerm } from "~/lib/roles";
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
import { SearchInput } from "~/components/ui/SearchInput";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { cn } from "~/lib/cn";
import { resolveTermFilter } from "~/lib/terms";
import {
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
} from "~/projects/lib/slot-roles";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import type { Question } from "~/types";

const SLOT = "referrals" as const;

export const meta: Route.MetaFunction = () => [
  { title: "Referrals · DALI OS" },
];

// This page mounts PartnerCrmNav itself, so the shell must not add its own
// subnav or breadcrumbs — same contract as the other Partner CRM tabs.
export const handle = { hideBreadcrumbs: true, areaSubnav: true };

// Read-only database of received referral submissions for the current cycle.
// Core only, like the rest of the Partner CRM. Members fill whichever generic
// form a manager bound to this cycle's "referrals" slot (see form-slots).
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

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
  //  - ?term=all → every existing cycle (read-only aggregate; don't create).
  //  - A specific term (default = current) → that term's cycle, get-or-create
  //    so the live cycle keeps its existing auto-provision behavior.
  let cycleIds: string[];
  let singleCycleId: string | null;
  if (isAll) {
    const cycles = await prisma.staffingCycle.findMany({
      select: { id: true },
    });
    cycleIds = cycles.map((c) => c.id);
    singleCycleId = null;
  } else {
    const t =
      termOptions.find((o) => o.id === filterTermId) ??
      (fallbackTerm
        ? { id: fallbackTerm.id, code: fallbackTerm.code }
        : termOptions[0]);
    const cycle = await ensureStaffingCycle(t.id, t.code);
    cycleIds = [cycle.id];
    singleCycleId = cycle.id;
  }

  // The generic-form slot binding is per-cycle, so it only applies to the
  // single-term view. In the all-terms aggregate there's no one slot to bind,
  // so the settings trigger is hidden (singleCycleId === null).
  const canManage = await canManageStaffing(auth.user.sub);
  const [binding, selectableForms] = await Promise.all([
    singleCycleId ? getSlotBinding(singleCycleId, SLOT) : Promise.resolve(null),
    canManage && singleCycleId
      ? listSelectableForms({ slot: SLOT, exceptCycleId: singleCycleId })
      : Promise.resolve([]),
  ]);

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
  // validating the saved mapping against them warns a manager that the
  // mapping is missing/stale before anyone submits.
  let formQuestions: {
    key: string;
    label: string;
    type: string;
    referenceSource?: string;
  }[] = [];
  let mappingWarning: string | null = null;
  if (binding) {
    const latest = await prisma.formVersion.findFirst({
      where: { form: { id: binding.formId } },
      orderBy: { versionNumber: "desc" },
      select: { questions: true },
    });
    const qs = (latest?.questions as unknown as Question[]) ?? [];
    formQuestions = qs.filter((q) => !q.data.showIf).map((q) => ({
      key: q.key,
      label: q.data.label,
      type: q.type,
      referenceSource: q.data.referenceSource,
    }));
    const check = validateMapping(SLOT, qs, binding.mapping);
    if (!check.ok) mappingWarning = check.reason;
  }

  const noFormConnected = !isAll && !binding;

  return {
    gate: "ok" as const,
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
  };
}

// Managers bind a generic form to this cycle's Referrals slot. Gated tighter
// than the loader: viewing the board is Core, changing the form requires
// staffing management (the slot machinery's own gate).
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canManageStaffing(auth.user.sub)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  // Bind to the cycle for the term the page is VIEWING (?term=), not whatever
  // term is live today — mirrors the loader's resolution so a binding saved
  // while viewing a non-live term lands on that term's cycle. Falls back to
  // the current term.
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

export default function PartnerReferralsDatabase() {
  const data = useLoaderData<typeof loader>();

  if (data.gate === "no-cycle") {
    return (
      <div className="flex flex-col gap-4">
        <PartnerCrmNav className="shrink-0 self-start" />
        <p className="text-sm text-muted-foreground">
          No active term right now.
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

  const columnFilters = useColumnFilters(data.tableColumns);

  const { search, setSearch, filtered } = useFilteredList(data.submissions, {
    searchFields: (s) => [s.name, s.email],
    predicates: [columnFilters.predicate],
    deps: [columnFilters.active],
  });

  const canOpenSettings = !data.isAll;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PartnerCrmNav className="shrink-0" />
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search referrals"
          containerClassName="flex-1 min-w-[180px] max-w-[320px]"
        />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={data.tableColumns}
            rows={data.submissions}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={filtered.length}
          />
        </div>
        {canOpenSettings && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 os-edit-btn"
          >
            {data.canManage ? "Advanced settings" : "View settings"}
          </button>
        )}
      </div>

      {canOpenSettings && (
        <SlotAdvancedSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          slot="referrals"
          slotLabel="Referrals"
          binding={data.binding}
          selectableForms={data.selectableForms}
          formQuestions={data.formQuestions}
          cycleTerms={[]}
          canManage={data.canManage}
        />
      )}

      {data.mappingWarning && (
        <div className="rounded-md border border-os-amber/40 bg-os-amber/10 px-3 py-2 text-sm text-os-amber">
          <span className="font-medium">Heads up:</span> {data.mappingWarning}{" "}
          Submissions are still recorded; affected columns just won’t render
          until you fix the mapping.
        </div>
      )}

      <div
        className={cn(
          "overflow-hidden",
          "rounded-os-card bg-os-card",
        )}
      >
        {data.noFormConnected ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Referrals form is connected for this term. Open{" "}
            <em>Advanced settings</em> to connect one so members can submit
            referrals.
          </div>
        ) : (
          <SubmissionDatabase
            columns={data.tableColumns}
            rows={filtered}
            // Carry the viewed term to the detail page; without it the detail
            // loader falls back to currentTerm() and opens the wrong term.
            detailBase={`/core/partners/referrals?term=${encodeURIComponent(data.selectedTerm)}`}
            emptyMessage={
              data.submissions.length === 0
                ? "No referral submissions yet."
                : "No members match the current filters."
            }
          />
        )}
      </div>
    </div>
  );
}
