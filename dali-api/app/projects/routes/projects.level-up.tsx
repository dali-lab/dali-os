import { useMemo, useState, useEffect } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/projects.level-up";
import { useFilteredList } from "~/hooks/useFilteredList";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseFormDataJson } from "~/lib/safe-json";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { applyEligibilityWithNotify } from "~/admin/lib/eligibility.server";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import {
  getSlotBinding,
  listSelectableForms,
  setSlotBinding,
  setSlotColumnMapping,
} from "../lib/form-slots";
import { SubmissionFilters } from "../components/SubmissionFilters";
import { SlotAdvancedSettingsModal } from "../components/SlotAdvancedSettingsModal";
import { DomainFilter } from "../components/DomainFilter";
import { TermFilter } from "~/components/TermFilter";
import { Modal, ModalHeader } from "~/components/Modal";
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
import { isLevel, type Level } from "~/lib/level";
import { regroupRedirect } from "~/core/lib/regroup-redirect.server";

const SLOT = "level-up" as const;

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Level Up · DALI OS" },
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

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  const regrouped = await regroupRedirect(
    request,
    auth.user.sub,
    "/projects/level-up",
    "/core/level-up",
  );
  if (regrouped) return regrouped;
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
    cycleIds = [cycle.id];
    cycleName = cycle.name;
    singleCycleId = cycle.id;
  }

  const canManage = await canManageStaffing(auth.user.sub);
  const [binding, selectableForms] = await Promise.all([
    singleCycleId ? getSlotBinding(singleCycleId, SLOT) : Promise.resolve(null),
    canManage && singleCycleId ? listSelectableForms() : Promise.resolve([]),
  ]);

  const view = await buildSubmissionView({
    cycleIds,
    slot: SLOT,
    formId: binding?.formId ?? null,
  });

  const tableColumns = view.tableColumns.map((c) => ({
    key: c.key,
    label: c.label,
  }));

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
    formQuestions = qs.map((q) => ({
      key: q.key,
      label: q.data.label,
      type: q.type,
      referenceSource: q.data.referenceSource,
    }));
    const check = validateMapping(SLOT, qs, binding.mapping);
    if (!check.ok) mappingWarning = check.reason;
  }

  const noFormConnected = !isAll && !binding;

  // Resolve target domain + level for each row so the Level Up button can
  // show a meaningful confirmation and be disabled when already promoted.
  // We need raw answers, not the display-resolved cell strings.
  const targetPromotion = await resolveTargetPromotions(
    view.rows.map((r) => r.userId),
    cycleIds,
    binding,
  );

  const submissions = view.rows.map((r) => ({
    ...r,
    targetPromotion: targetPromotion.get(r.userId) ?? null,
  }));

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
    cycle: { name: cycleName, id: singleCycleId },
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

export type TargetPromotion = {
  domainId: string;
  domainName: string;
  targetLevel: Level;
  alreadyPromoted: boolean;
} | null;

// Resolves target domain + level for each user from their raw form submission.
// Returns null for rows where the mapping doesn't have target-domain /
// target-level, or the answers can't be resolved.
async function resolveTargetPromotions(
  userIds: string[],
  cycleIds: string[],
  binding: Awaited<ReturnType<typeof getSlotBinding>>,
): Promise<Map<string, TargetPromotion>> {
  const result = new Map<string, TargetPromotion>();
  if (!binding?.mapping || userIds.length === 0) return result;

  const domainEntry = binding.mapping.entries.find(
    (e) => e.role === "target-domain" && e.source === "question",
  );
  const levelEntry = binding.mapping.entries.find(
    (e) => e.role === "target-level" && e.source === "question",
  );
  if (!domainEntry || !levelEntry) return result;

  const domainKey =
    domainEntry.source === "question" ? domainEntry.questionKey : null;
  const levelKey =
    levelEntry.source === "question" ? levelEntry.questionKey : null;
  if (!domainKey || !levelKey) return result;

  const subs = await prisma.formSubmission.findMany({
    where: {
      staffingCycleId: { in: cycleIds },
      slot: SLOT,
      userId: { in: userIds },
    },
    orderBy: { createdAt: "desc" },
    select: { userId: true, answers: true },
  });

  // Most recent submission per user.
  const seen = new Set<string>();
  const rawByUser = new Map<string, Record<string, unknown>>();
  for (const s of subs) {
    if (!s.userId || seen.has(s.userId)) continue;
    seen.add(s.userId);
    rawByUser.set(s.userId, (s.answers as Record<string, unknown>) ?? {});
  }

  // Batch-resolve domain ids + names. We try treating the raw answer as a
  // domain ID first; if that misses we fall back to displayName matching.
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

  // Current eligibility levels per user so we can flag already-promoted rows.
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
    const rawLevel = answers[levelKey];
    if (typeof rawDomain !== "string" || typeof rawLevel !== "string") {
      result.set(userId, null);
      continue;
    }
    const domain =
      domainLookup.get(rawDomain) ??
      domainLookup.get(rawDomain.toLowerCase());
    const targetLevel = parseLevel(rawLevel);
    if (!domain || !targetLevel) {
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

  // Form binding and mapping: managers only.
  if (intent === "set-slot-form" || intent === "set-slot-mapping") {
    if (!(await canManageStaffing(auth.user.sub)))
      return Response.json({ error: "Forbidden" }, { status: 403 });

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
  }

  // Note saving: anyone who can view the page.
  // Level Up: managers only.
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

export default function LevelUpDatabase() {
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
  const [domainId, setDomainId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmRow, setConfirmRow] = useState<{
    userId: string;
    name: string;
    domainId: string;
    domainName: string;
    targetLevel: Level;
  } | null>(null);

  const { search, setSearch, filtered } = useFilteredList(data.submissions, {
    searchFields: (s) => [s.name, s.email],
    predicates: [(s) => !domainId || s.domainIds.includes(domainId)],
    deps: [domainId],
  });

  const domains = useMemo(
    () => data.domainOptions.map((d) => ({ id: d.id, name: d.displayName })),
    [data.domainOptions],
  );

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
          slot="level-up"
          slotLabel="Level Up"
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
          Submissions are still recorded; affected columns won't feed staffing
          until you fix the mapping.
        </div>
      )}

      {data.slotStatus && <SlotStatusStrip status={data.slotStatus} />}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SubmissionFilters query={search} onQueryChange={setSearch} />
        </div>
        <DomainFilter domains={domains} value={domainId} onChange={setDomainId} />
        <TermFilter terms={data.termOptions} selected={data.selectedTerm} />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {data.noFormConnected ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Level Up form is connected for this term. Open{" "}
            <em>Advanced settings</em> to connect one.
          </div>
        ) : (
          <LevelUpTable
            columns={data.tableColumns}
            rows={filtered}
            canManage={data.canManage}
            emptyMessage={
              data.submissions.length === 0
                ? "No Level Up submissions yet."
                : "No members match the current filters."
            }
            onLevelUp={(row) => setConfirmRow(row)}
          />
        )}
      </div>

      {confirmRow && (
        <LevelUpConfirmDialog
          row={confirmRow}
          onClose={() => setConfirmRow(null)}
        />
      )}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

type TableRow = LoadedData["submissions"][number];

function LevelUpTable({
  columns,
  rows,
  canManage,
  emptyMessage,
  onLevelUp,
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
            <LevelUpRow
              key={r.userId}
              row={r}
              columns={columns}
              canManage={canManage}
              onLevelUp={onLevelUp}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LevelUpRow({
  row,
  columns,
  canManage,
  onLevelUp,
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
}) {
  const tp = row.targetPromotion;

  const levelLabel: Record<Level, string> = { P1: "P1", P2: "P2", P3: "P3" };

  return (
    <tr className="border-t border-border hover:bg-muted/10">
      <td className="px-4 py-2">
        <a
          href={`/projects/level-up/${row.userId}`}
          className="text-foreground hover:underline"
          onClick={(e) => {
            // Allow middle-click / cmd-click to open new tab naturally.
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              window.location.href = `/projects/level-up/${row.userId}`;
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
            {v === "" ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              v
            )}
          </td>
        );
      })}
      {canManage && (
        <td className="px-4 py-2">
          {tp ? (
            tp.alreadyPromoted ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200"
                title={`Already at ${levelLabel[tp.targetLevel]} in ${tp.domainName}`}
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
                Level Up → {levelLabel[tp.targetLevel]}
              </button>
            )
          ) : (
            <span
              className="text-xs text-muted-foreground"
              title="Map target-domain and target-level columns to enable this button"
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
      labelledBy="level-up-confirm-title"
      disableEscape={pending}
      containerClassName="bg-card border border-border rounded-lg shadow-lg w-full max-w-sm p-6 flex flex-col gap-4 my-auto"
    >
      <>
        <ModalHeader
          titleId="level-up-confirm-title"
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
        <p className="text-xs text-muted-foreground">
          This updates their Domain Eligibility and takes effect immediately.
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

// ─── Header ───────────────────────────────────────────────────────────────────

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
    <AreaPillNav items={projectsPills({ canViewStaffing: true, active: "level-up" })} />
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Level Up
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Member level up applications{cycleName ? ` for ${cycleName}` : ""}.
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
