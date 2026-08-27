import { useMemo, useRef, useState, useEffect } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/core.growth";
import { useFilteredList } from "~/hooks/useFilteredList";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseFormDataJson } from "~/lib/safe-json";
import {
  canManageStaffing,
  canViewStaffing,
  currentTerm,
  getUserRoles,
} from "~/lib/roles";
import { prisma } from "~/lib/db";
import { applyEligibilityWithNotify } from "~/admin/lib/eligibility.server";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import {
  getSlotBinding,
  listSelectableForms,
  setSlotBinding,
  setSlotColumnMapping,
  setSlotEnabled,
} from "~/projects/lib/form-slots";
import { ensureGrowthBindings } from "~/projects/lib/growth.server";
import { SubmissionFilters } from "~/projects/components/SubmissionFilters";
import { SlotAdvancedSettingsModal } from "~/projects/components/SlotAdvancedSettingsModal";
import { DomainFilter } from "~/projects/components/DomainFilter";
import { TermFilter } from "~/components/TermFilter";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { Modal, ModalHeader } from "~/components/Modal";
import { Select } from "~/components/ui/floating/Select";
import { resolveTermFilter } from "~/lib/terms";
import {
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
} from "~/projects/lib/slot-roles";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { deriveSlotStatus, type SlotStatus } from "~/projects/lib/slot-status.server";
import { SlotStatusStrip } from "~/projects/components/SlotStatusStrip";
import { coreHandle } from "~/core/coreNav";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import type { Question } from "~/types";
import { isLevel, type Level } from "~/lib/level";

export const handle = {
  ...coreHandle("growth"),
  areaPills: true,
};

export const meta: Route.MetaFunction = () => [
  { title: "Growth · DALI OS" },
];

// Parses a level string to Level enum. Accepts "P1"/"P2"/"P3" and their full
// names "Learner"/"Doer"/"Mentor" (case-insensitive).
function parseLevel(raw: string): Level | null {
  const s = raw.trim().toLowerCase();
  if (s === "p1" || s === "learner") return "P1";
  if (s === "p2" || s === "doer") return "P2";
  if (s === "p3" || s === "mentor") return "P3";
  return null;
}

type SlotBindingData = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
  updatedAt: string;
  enabled: boolean;
  mapping: ColumnMapping | null;
} | null;

async function loadSlotData(
  singleCycleId: string | null,
  slot: "level-up" | "domain-join",
  canManage: boolean,
  cycleIds: string[],
) {
  const [binding, selectableForms] = await Promise.all([
    singleCycleId ? getSlotBinding(singleCycleId, slot) : Promise.resolve(null),
    canManage && singleCycleId ? listSelectableForms() : Promise.resolve([]),
  ]);

  const view = await buildSubmissionView({
    cycleIds,
    slot,
    formId: binding?.formId ?? null,
  });

  const tableColumns = view.tableColumns.map((c) => ({ key: c.key, label: c.label }));

  let formQuestions: { key: string; label: string; type: string; referenceSource?: string }[] = [];
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
    const check = validateMapping(slot, qs, binding.mapping);
    if (!check.ok) mappingWarning = check.reason;
  }

  const slotStatus: SlotStatus | null = singleCycleId
    ? (await deriveSlotStatus(singleCycleId)).find((s) => s.slot === slot) ?? null
    : null;

  return { binding, selectableForms, view, tableColumns, formQuestions, mappingWarning, slotStatus };
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const roles = await getUserRoles(auth.user.sub, request);
  const domainHubsEnabled = await isFeatureEnabled(
    "domain-hubs",
    auth.user.sub,
    roles,
    request,
  );

  const {
    terms: termOptions,
    selected: selectedTerm,
    termId: filterTermId,
    isAll,
  } = await resolveTermFilter(request);

  const fallbackTerm = await currentTerm();
  if (!fallbackTerm && termOptions.length === 0)
    return { gate: "no-cycle" as const };

  let cycleIds: string[];
  let cycleName: string;
  let singleCycleId: string | null;
  if (isAll) {
    const cycles = await prisma.staffingCycle.findMany({ select: { id: true } });
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
    // Carry forward any prior Growth bindings to this cycle on first load.
    await ensureGrowthBindings(cycle.id);
    cycleIds = [cycle.id];
    cycleName = cycle.name;
    singleCycleId = cycle.id;
  }

  const canManage = await canManageStaffing(auth.user.sub);

  const [levelUpData, domainJoinData] = await Promise.all([
    loadSlotData(singleCycleId, "level-up", canManage, cycleIds),
    domainHubsEnabled
      ? loadSlotData(singleCycleId, "domain-join", canManage, cycleIds)
      : Promise.resolve(null),
  ]);

  const targetPromotion = await resolveTargetPromotions(
    levelUpData.view.rows.map((r) => r.userId),
    cycleIds,
    levelUpData.binding,
    "level-up",
  );

  const levelUpSubmissions = levelUpData.view.rows.map((r) => ({
    ...r,
    targetPromotion: targetPromotion.get(r.userId) ?? null,
  }));

  // For domain-join, all approved actions enter at P1 with no prior eligibility.
  let domainJoinSubmissions: typeof levelUpSubmissions = [];
  if (domainJoinData) {
    const djPromotion = await resolveTargetPromotions(
      domainJoinData.view.rows.map((r) => r.userId),
      cycleIds,
      domainJoinData.binding,
      "domain-join",
    );
    domainJoinSubmissions = domainJoinData.view.rows.map((r) => ({
      ...r,
      targetPromotion: djPromotion.get(r.userId) ?? null,
    }));
  }

  const domainOptions = await prisma.domain.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });

  // For the Level-up rubrics settings section: skill domains + their current
  // rubric association, and the full rubric list for the picker.
  const [skillDomains, allRubrics] = await Promise.all([
    prisma.domain.findMany({
      where: { active: true, isSystem: false, isInternProgram: false },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, levelUpRubricId: true },
    }),
    prisma.rubric.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return {
    gate: "ok" as const,
    cycle: { name: cycleName, id: singleCycleId },
    termOptions,
    selectedTerm,
    isAll,
    canManage,
    domainOptions,
    domainHubsEnabled,
    skillDomains,
    allRubrics,
    // Level-up slot
    levelUpSubmissions,
    levelUpTableColumns: levelUpData.tableColumns,
    levelUpBinding: levelUpData.binding,
    levelUpSelectableForms: levelUpData.selectableForms,
    levelUpFormQuestions: levelUpData.formQuestions,
    levelUpMappingWarning: levelUpData.mappingWarning,
    levelUpSlotStatus: levelUpData.slotStatus,
    levelUpNoForm: !isAll && !levelUpData.binding,
    // Domain-join slot (only when domain-hubs flag is on)
    domainJoinSubmissions,
    domainJoinTableColumns: domainJoinData?.tableColumns ?? [],
    domainJoinBinding: domainJoinData?.binding ?? null,
    domainJoinSelectableForms: domainJoinData?.selectableForms ?? [],
    domainJoinFormQuestions: domainJoinData?.formQuestions ?? [],
    domainJoinMappingWarning: domainJoinData?.mappingWarning ?? null,
    domainJoinSlotStatus: domainJoinData?.slotStatus ?? null,
    domainJoinNoForm: domainHubsEnabled && !isAll && !domainJoinData?.binding,
  };
}

export type TargetPromotion = {
  domainId: string;
  domainName: string;
  targetLevel: Level;
  alreadyPromoted: boolean;
} | null;

async function resolveTargetPromotions(
  userIds: string[],
  cycleIds: string[],
  binding: Awaited<ReturnType<typeof getSlotBinding>>,
  slot: "level-up" | "domain-join",
): Promise<Map<string, TargetPromotion>> {
  const result = new Map<string, TargetPromotion>();
  if (!binding?.mapping || userIds.length === 0) return result;

  const domainEntry = binding.mapping.entries.find(
    (e) => e.role === "target-domain" && e.source === "question",
  );
  const levelEntry = binding.mapping.entries.find(
    (e) => e.role === "target-level" && e.source === "question",
  );
  if (!domainEntry) return result;

  const domainKey = domainEntry.source === "question" ? domainEntry.questionKey : null;
  const levelKey = levelEntry?.source === "question" ? levelEntry.questionKey : null;
  if (!domainKey) return result;

  const subs = await prisma.formSubmission.findMany({
    where: {
      staffingCycleId: { in: cycleIds },
      slot,
      userId: { in: userIds },
    },
    orderBy: { createdAt: "desc" },
    select: { userId: true, answers: true },
  });

  const seen = new Set<string>();
  const rawByUser = new Map<string, Record<string, unknown>>();
  for (const s of subs) {
    if (!s.userId || seen.has(s.userId)) continue;
    seen.add(s.userId);
    rawByUser.set(s.userId, (s.answers as Record<string, unknown>) ?? {});
  }

  const rawDomainAnswers = [...rawByUser.values()]
    .map((a) => a[domainKey])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const uniqueAnswers = [...new Set(rawDomainAnswers)];

  const byId = await prisma.domain.findMany({
    where: { id: { in: uniqueAnswers } },
    select: { id: true, displayName: true },
  });
  const byName = await prisma.domain.findMany({
    where: {
      displayName: {
        in: uniqueAnswers.filter((a) => !byId.find((d) => d.id === a)),
        mode: "insensitive",
      },
    },
    select: { id: true, displayName: true },
  });
  const domainLookup = new Map<string, { id: string; displayName: string }>();
  for (const d of [...byId, ...byName]) {
    domainLookup.set(d.id, d);
    domainLookup.set(d.displayName.toLowerCase(), d);
  }

  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, domainId: true, level: true },
  });
  type EligKey = `${string}:${string}`;
  const currentLevel = new Map<EligKey, Level>();
  for (const e of eligibilities) {
    currentLevel.set(`${e.userId}:${e.domainId}`, e.level);
  }

  const LEVEL_ORDER: Record<Level, number> = { P1: 1, P2: 2, P3: 3 };

  for (const userId of userIds) {
    const answers = rawByUser.get(userId);
    if (!answers) {
      result.set(userId, null);
      continue;
    }
    const rawDomain = answers[domainKey];
    // For domain-join: default to P1 when the level question isn't mapped.
    const rawLevel = levelKey ? answers[levelKey] : "P1";
    if (typeof rawDomain !== "string") {
      result.set(userId, null);
      continue;
    }
    const domain =
      domainLookup.get(rawDomain) ?? domainLookup.get(rawDomain.toLowerCase());
    const targetLevel =
      typeof rawLevel === "string" ? (parseLevel(rawLevel) ?? "P1") : "P1";
    if (!domain) {
      result.set(userId, null);
      continue;
    }
    const existing = currentLevel.get(`${userId}:${domain.id}`);
    const alreadyPromoted = Boolean(
      existing && LEVEL_ORDER[existing] >= LEVEL_ORDER[targetLevel],
    );
    result.set(userId, {
      domainId: domain.id,
      domainName: domain.displayName,
      targetLevel,
      alreadyPromoted,
    });
  }

  return result;
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

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
  // The slot this action targets (level-up or domain-join).
  const rawSlot = String(form.get("slot") ?? "level-up");
  const slot = rawSlot === "domain-join" ? "domain-join" : "level-up";

  if (
    intent === "set-slot-form" ||
    intent === "set-slot-mapping" ||
    intent === "set-slot-enabled"
  ) {
    if (!(await canManageStaffing(auth.user.sub)))
      return Response.json({ error: "Forbidden" }, { status: 403 });

    if (intent === "set-slot-form") {
      const formId = String(form.get("formId") ?? "");
      const result = await setSlotBinding(cycle.id, slot, formId, auth.user.sub);
      if (!result.ok)
        return Response.json({ error: result.error }, { status: 400 });
      return Response.json({ ok: true });
    }

    if (intent === "set-slot-mapping") {
      const binding = await getSlotBinding(cycle.id, slot);
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
      const check = validateMapping(slot, qs, mapping);
      if (!check.ok)
        return Response.json({ error: check.reason }, { status: 400 });
      const result = await setSlotColumnMapping(
        cycle.id,
        slot,
        mapping as ColumnMapping,
        auth.user.sub,
      );
      if (!result.ok)
        return Response.json({ error: result.error }, { status: 400 });
      return Response.json({ ok: true });
    }

    if (intent === "set-slot-enabled") {
      const enabled = form.get("enabled") === "true";
      const result = await setSlotEnabled(cycle.id, slot, enabled, auth.user.sub);
      if (!result.ok)
        return Response.json({ error: result.error }, { status: 400 });
      return Response.json({ ok: true });
    }
  }

  if (intent === "set-domain-rubric") {
    if (!(await canManageStaffing(auth.user.sub)))
      return Response.json({ error: "Forbidden" }, { status: 403 });
    const domainId = String(form.get("domainId") ?? "");
    const rubricId = String(form.get("rubricId") ?? "") || null;
    if (!domainId)
      return Response.json({ error: "domainId required" }, { status: 400 });
    await prisma.domain.update({
      where: { id: domainId },
      data: { levelUpRubricId: rubricId },
    });
    return Response.json({ ok: true });
  }

  if (intent === "level-up-member") {
    if (!(await canManageStaffing(auth.user.sub)))
      return Response.json({ error: "Forbidden" }, { status: 403 });
    const targetUserId = String(form.get("userId") ?? "");
    const domainId = String(form.get("domainId") ?? "");
    const targetLevel = String(form.get("targetLevel") ?? "");
    if (!targetUserId || !domainId || !isLevel(targetLevel))
      return Response.json({ error: "Invalid parameters." }, { status: 400 });

    await applyEligibilityWithNotify({
      userId: targetUserId,
      domainId,
      level: targetLevel,
      actorId: auth.user.sub,
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GrowthBoard() {
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

type LoadedData = Extract<Awaited<ReturnType<typeof loader>>, { gate: "ok" }>;

function Loaded({ data }: { data: LoadedData }) {
  const { os } = useOsChrome();
  const [domainId, setDomainId] = useState("");
  const [levelUpSettingsOpen, setLevelUpSettingsOpen] = useState(false);
  const [domainJoinSettingsOpen, setDomainJoinSettingsOpen] = useState(false);
  const [confirmRow, setConfirmRow] = useState<{
    userId: string;
    name: string;
    domainId: string;
    domainName: string;
    targetLevel: Level;
  } | null>(null);

  const { search, setSearch, filtered: filteredLevelUp } = useFilteredList(
    data.levelUpSubmissions,
    {
      searchFields: (s) => [s.name, s.email],
      predicates: [(s) => !domainId || s.domainIds.includes(domainId)],
      deps: [domainId],
    },
  );

  const { filtered: filteredDomainJoin } = useFilteredList(
    data.domainJoinSubmissions,
    {
      searchFields: (s) => [s.name, s.email],
      predicates: [(s) => !domainId || s.domainIds.includes(domainId)],
      deps: [domainId],
    },
  );

  const domains = useMemo(
    () => data.domainOptions.map((d) => ({ id: d.id, name: d.displayName })),
    [data.domainOptions],
  );

  const canOpenSettings = !data.isAll;

  return (
    <div className="flex flex-col gap-6">
      <Header
        cycleName={data.cycle.name}
        onOpenLevelUpSettings={
          canOpenSettings ? () => setLevelUpSettingsOpen(true) : undefined
        }
        onOpenDomainJoinSettings={
          canOpenSettings && data.domainHubsEnabled
            ? () => setDomainJoinSettingsOpen(true)
            : undefined
        }
        settingsLabel={data.canManage ? "Advanced settings" : "View settings"}
      />

      {canOpenSettings && (
        <>
          <SlotAdvancedSettingsModal
            open={levelUpSettingsOpen}
            onClose={() => setLevelUpSettingsOpen(false)}
            slot="level-up"
            slotLabel="Level Up"
            binding={data.levelUpBinding}
            selectableForms={data.levelUpSelectableForms}
            formQuestions={data.levelUpFormQuestions}
            cycleTerms={[]}
            canManage={data.canManage}
          />
          {data.domainHubsEnabled && (
            <SlotAdvancedSettingsModal
              open={domainJoinSettingsOpen}
              onClose={() => setDomainJoinSettingsOpen(false)}
              slot="domain-join"
              slotLabel="Domain Join"
              binding={data.domainJoinBinding}
              selectableForms={data.domainJoinSelectableForms}
              formQuestions={data.domainJoinFormQuestions}
              cycleTerms={[]}
              canManage={data.canManage}
            />
          )}
        </>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SubmissionFilters query={search} onQueryChange={setSearch} />
        </div>
        <DomainFilter domains={domains} value={domainId} onChange={setDomainId} />
        <TermFilter terms={data.termOptions} selected={data.selectedTerm} />
      </div>

      {/* ── Level-up rubrics (Core managers only) ── */}
      {data.canManage && (
        <LevelUpRubricsSection
          skillDomains={data.skillDomains}
          allRubrics={data.allRubrics}
        />
      )}

      {/* ── Level Up section ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Level Up</h2>
            <p className="text-xs text-muted-foreground">
              Members requesting a higher level in a domain they&apos;re already in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canOpenSettings && data.canManage && data.levelUpBinding && (
              <FlowToggle
                slot="level-up"
                enabled={data.levelUpBinding.enabled}
              />
            )}
            {canOpenSettings && (
              <button
                type="button"
                onClick={() => setLevelUpSettingsOpen(true)}
                className={cn(
                  "shrink-0 text-sm",
                  os
                    ? "os-edit-btn"
                    : "px-3 py-1.5 font-medium rounded-md border border-border text-foreground hover:bg-muted",
                )}
              >
                {data.canManage ? "Settings" : "View settings"}
              </button>
            )}
          </div>
        </div>

        {data.levelUpMappingWarning && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span className="font-medium">Heads up:</span> {data.levelUpMappingWarning}
          </div>
        )}

        {data.levelUpSlotStatus && <SlotStatusStrip status={data.levelUpSlotStatus} />}

        <div
          className={cn(
            "overflow-hidden",
            os ? "rounded-os-card bg-os-card" : "bg-card border border-border rounded-lg",
          )}
        >
          {data.levelUpNoForm ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No Level Up form is connected for this term. Open{" "}
              <em>Settings</em> to connect one.
            </div>
          ) : (
            <GrowthTable
              columns={data.levelUpTableColumns}
              rows={filteredLevelUp}
              canManage={data.canManage}
              emptyMessage={
                data.levelUpSubmissions.length === 0
                  ? "No Level Up requests yet."
                  : "No members match the current filters."
              }
              onLevelUp={(row) => setConfirmRow(row)}
              detailHref={(userId) => `/core/growth/${userId}`}
            />
          )}
        </div>
      </section>

      {/* ── Domain Join section (domain-hubs flag) ── */}
      {data.domainHubsEnabled && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Domain Join</h2>
              <p className="text-xs text-muted-foreground">
                Members requesting to join a domain they hold no eligibility in → P1.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canOpenSettings && data.canManage && data.domainJoinBinding && (
                <FlowToggle
                  slot="domain-join"
                  enabled={data.domainJoinBinding.enabled}
                />
              )}
              {canOpenSettings && (
                <button
                  type="button"
                  onClick={() => setDomainJoinSettingsOpen(true)}
                  className={cn(
                    "shrink-0 text-sm",
                    os
                      ? "os-edit-btn"
                      : "px-3 py-1.5 font-medium rounded-md border border-border text-foreground hover:bg-muted",
                  )}
                >
                  {data.canManage ? "Settings" : "View settings"}
                </button>
              )}
            </div>
          </div>

          {data.domainJoinMappingWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span className="font-medium">Heads up:</span> {data.domainJoinMappingWarning}
            </div>
          )}

          {data.domainJoinSlotStatus && (
            <SlotStatusStrip status={data.domainJoinSlotStatus} />
          )}

          <div
            className={cn(
              "overflow-hidden",
              os ? "rounded-os-card bg-os-card" : "bg-card border border-border rounded-lg",
            )}
          >
            {data.domainJoinNoForm ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No Domain Join form is connected for this term. Open{" "}
                <em>Settings</em> to connect one.
              </div>
            ) : (
              <GrowthTable
                columns={data.domainJoinTableColumns}
                rows={filteredDomainJoin}
                canManage={data.canManage}
                emptyMessage={
                  data.domainJoinSubmissions.length === 0
                    ? "No Domain Join requests yet."
                    : "No members match the current filters."
                }
                onLevelUp={(row) => setConfirmRow(row)}
                detailHref={(userId) => `/core/growth/${userId}`}
                joinMode
              />
            )}
          </div>
        </section>
      )}

      {confirmRow && (
        <LevelUpConfirmDialog
          row={confirmRow}
          onClose={() => setConfirmRow(null)}
        />
      )}
    </div>
  );
}

// ─── Open/Closed toggle ───────────────────────────────────────────────────────

function FlowToggle({ slot, enabled }: { slot: "level-up" | "domain-join"; enabled: boolean }) {
  const fetcher = useFetcher();
  const optimisticEnabled =
    fetcher.state !== "idle"
      ? (fetcher.formData?.get("enabled") === "true")
      : enabled;

  return (
    <fetcher.Form method="post" className="flex items-center gap-1.5">
      <input type="hidden" name="intent" value="set-slot-enabled" />
      <input type="hidden" name="slot" value={slot} />
      <input type="hidden" name="enabled" value={optimisticEnabled ? "false" : "true"} />
      <button
        type="submit"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors",
          optimisticEnabled
            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
            : "bg-muted text-muted-foreground border-border hover:bg-muted/80",
        )}
        title={optimisticEnabled ? "Close this flow" : "Open this flow"}
      >
        {optimisticEnabled ? "Open" : "Closed"}
      </button>
    </fetcher.Form>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

type TableRow = LoadedData["levelUpSubmissions"][number];

function GrowthTable({
  columns,
  rows,
  canManage,
  emptyMessage,
  onLevelUp,
  detailHref,
  joinMode = false,
}: {
  columns: { key: string; label: string }[];
  rows: TableRow[];
  canManage: boolean;
  emptyMessage: string;
  onLevelUp: (row: {
    userId: string;
    name: string;
    domainId: string;
    domainName: string;
    targetLevel: Level;
  }) => void;
  detailHref: (userId: string) => string;
  joinMode?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Member</th>
            {columns.map((c) => (
              <th key={c.key} className="text-left font-medium px-4 py-2">
                {c.label}
              </th>
            ))}
            {canManage && (
              <th className="text-left font-medium px-4 py-2">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <GrowthRow
              key={r.userId}
              row={r}
              columns={columns}
              canManage={canManage}
              onLevelUp={onLevelUp}
              detailHref={detailHref}
              joinMode={joinMode}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrowthRow({
  row,
  columns,
  canManage,
  onLevelUp,
  detailHref,
  joinMode,
}: {
  row: TableRow;
  columns: { key: string; label: string }[];
  canManage: boolean;
  onLevelUp: (row: {
    userId: string;
    name: string;
    domainId: string;
    domainName: string;
    targetLevel: Level;
  }) => void;
  detailHref: (userId: string) => string;
  joinMode: boolean;
}) {
  const tp = row.targetPromotion;

  return (
    <tr className="border-t border-border hover:bg-muted/10">
      <td className="px-4 py-2">
        <a
          href={detailHref(row.userId)}
          className="text-foreground hover:underline"
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              window.location.href = detailHref(row.userId);
            }
          }}
        >
          {row.name}
        </a>
      </td>
      {columns.map((c) => {
        const v = row.cells[c.key] ?? "";
        return (
          <td key={c.key} className="px-4 py-2 text-foreground">
            {v === "" ? <span className="text-muted-foreground">—</span> : v}
          </td>
        );
      })}
      {canManage && (
        <td className="px-4 py-2">
          {tp ? (
            tp.alreadyPromoted ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200"
                title={`Already at ${tp.targetLevel} in ${tp.domainName}`}
              >
                Promoted ✓
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onLevelUp({
                    userId: row.userId,
                    name: row.name,
                    domainId: tp.domainId,
                    domainName: tp.domainName,
                    targetLevel: tp.targetLevel,
                  })
                }
                className="px-3 py-1 text-xs font-medium rounded bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
              >
                {joinMode
                  ? `Join → P1 (${tp.domainName})`
                  : `Level up → ${tp.targetLevel}`}
              </button>
            )
          ) : (
            <span
              className="text-xs text-muted-foreground"
              title="Map target-domain column to enable this button"
            >
              —
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function LevelUpConfirmDialog({
  row,
  onClose,
}: {
  row: {
    userId: string;
    name: string;
    domainId: string;
    domainName: string;
    targetLevel: Level;
  };
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { ok?: boolean }).ok) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="growth-confirm-title"
      disableEscape={pending}
      containerClassName="bg-card border border-border rounded-lg shadow-lg w-full max-w-sm p-6 flex flex-col gap-4 my-auto"
    >
      <>
        <ModalHeader
          titleId="growth-confirm-title"
          title="Confirm Level Up"
          onClose={onClose}
          className="mb-0"
        />
        <p className="text-sm text-foreground">
          Promote{" "}
          <span className="font-semibold">{row.name}</span> to{" "}
          <span className="font-semibold">{row.targetLevel}</span> in{" "}
          <span className="font-semibold">{row.domainName}</span>?
        </p>
        {fetcher.data && !(fetcher.data as { ok?: boolean }).ok && (
          <p className="text-sm text-red-600">
            {(fetcher.data as { error?: string }).error ?? "Something went wrong."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="level-up-member" />
            <input type="hidden" name="userId" value={row.userId} />
            <input type="hidden" name="domainId" value={row.domainId} />
            <input type="hidden" name="targetLevel" value={row.targetLevel} />
            <button
              type="submit"
              disabled={pending}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Promoting…" : "Confirm"}
            </button>
          </fetcher.Form>
        </div>
      </>
    </Modal>
  );
}

// ─── Level-up rubrics settings ────────────────────────────────────────────────

// One row in the rubric picker table. Uses its own fetcher so concurrent saves
// per domain don't collide on a single fetcher's state.
function DomainRubricRow({
  domain,
  rubricOptions,
  fetcher,
}: {
  domain: LoadedData["skillDomains"][number];
  rubricOptions: { value: string; label: string }[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-foreground font-medium shrink-0">{domain.displayName}</span>
      <fetcher.Form method="post" ref={formRef} className="flex items-center gap-2">
        <input type="hidden" name="intent" value="set-domain-rubric" />
        <input type="hidden" name="domainId" value={domain.id} />
        <Select
          name="rubricId"
          options={rubricOptions}
          defaultValue={domain.levelUpRubricId ?? ""}
          placeholder="None"
          onChange={() => {
            // Select writes the hidden <select>.value before calling onChange,
            // so FormData reads the fresh value synchronously.
            if (formRef.current) fetcher.submit(formRef.current);
          }}
        />
      </fetcher.Form>
    </div>
  );
}

// Core-only section: associates a Rubric (created in /hiring/library) with each
// skill domain so the per-user growth review page shows scored criteria instead
// of the old name-based fallback.
function LevelUpRubricsSection({
  skillDomains,
  allRubrics,
}: {
  skillDomains: LoadedData["skillDomains"];
  allRubrics: LoadedData["allRubrics"];
}) {
  const fetcher = useFetcher();

  const rubricOptions = [
    { value: "", label: "None" },
    ...allRubrics.map((r) => ({ value: r.id, label: r.name })),
  ];

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Level-up rubrics</h2>
        <p className="text-xs text-muted-foreground">
          Choose which rubric is used to score each domain&apos;s growth requests.{" "}
          <a
            href="/hiring/library?tab=rubrics"
            className="underline hover:text-foreground"
          >
            Manage rubric criteria →
          </a>
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
        {skillDomains.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted-foreground">No skill domains configured.</p>
        )}
        {skillDomains.map((domain) => (
          <DomainRubricRow
            key={domain.id}
            domain={domain}
            rubricOptions={rubricOptions}
            fetcher={fetcher}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({
  cycleName,
  onOpenLevelUpSettings,
  onOpenDomainJoinSettings,
  settingsLabel,
}: {
  cycleName?: string;
  onOpenLevelUpSettings?: () => void;
  onOpenDomainJoinSettings?: () => void;
  settingsLabel?: string;
}) {
  const { pageTitle } = useOsChrome();
  const domainHubs = useFeatureFlag("domain-hubs");

  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className={pageTitle}>Growth</h1>
        {cycleName && (
          <p className="text-sm text-muted-foreground">{cycleName}</p>
        )}
      </div>
      {(onOpenLevelUpSettings || (domainHubs && onOpenDomainJoinSettings)) && (
        <div className="flex items-center gap-2 shrink-0">
          {onOpenLevelUpSettings && (
            <button
              type="button"
              onClick={onOpenLevelUpSettings}
              className="os-edit-btn text-sm"
            >
              Level Up {settingsLabel ?? "settings"}
            </button>
          )}
          {domainHubs && onOpenDomainJoinSettings && (
            <button
              type="button"
              onClick={onOpenDomainJoinSettings}
              className="os-edit-btn text-sm"
            >
              Domain Join {settingsLabel ?? "settings"}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
