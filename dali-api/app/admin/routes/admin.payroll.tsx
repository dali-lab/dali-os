import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.payroll";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Download,
  Upload,
  ChevronRight,
  StickyNote,
  AlertTriangle,
  Info,
  X,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import {
  ChartStringValidationError,
  recordProjectChartString,
  resolveChartStringsForTerm,
} from "~/lib/chart-string.server";
import { resolveTermFilter } from "~/lib/terms";
import {
  getReconciliation,
  type ReconciliationResult,
  type TimesheetNoteView,
} from "~/admin/lib/payroll-reconcile.server";
import type { JobBreakdown } from "~/admin/lib/payroll-collation";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Figure, Pill, adminTable } from "~/admin/components/console-ui";
import { TermFilter } from "~/components/TermFilter";
import { SearchInput } from "~/components/ui/SearchInput";
import { Modal, ModalHeader } from "~/components/Modal";
import { useOsChrome } from "~/components/os-chrome";
import { formatUsd } from "~/lib/money";
import { cn } from "~/lib/cn";
import { Tooltip as UiTooltip, InfoTip } from "~/components/ui/floating";
import { PayrollUploadModal } from "~/admin/components/PayrollUploadModal";
import { PayrollBudgetPanel } from "~/admin/components/PayrollBudgetPanel";

export const handle = adminHandle("reconcile");

export const meta: Route.MetaFunction = () => [
  { title: "Reconcile · Payroll · Admin · DALI OS" },
];

export type PeriodSummary = {
  id: string;
  name: string;
  termCode: string | null;
  entries: number;
  importedBy: string | null;
  importedAt: string | null;
};

export type MissingChartString = {
  projectId: string;
  name: string;
  /** The latest earlier term in which the project had its own string. */
  lastOwnTermCode: string;
};

export type ProjectChartString = {
  chartString: string;
  source: "project" | "labDefault" | "builtIn";
};

export type SetChartStringResult =
  | { ok: true; projectId: string; chartString: string; warnings: string[] }
  | { ok: false; projectId?: string; error: string };

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin/members");

  const termFilter = await resolveTermFilter(request);
  const { termId } = termFilter;

  if (!termId) {
    return {
      ...termFilter,
      reconciliation: null as ReconciliationResult | null,
      periods: [] as PeriodSummary[],
      missingChartStrings: [] as MissingChartString[],
      projectChartStrings: {} as Record<string, ProjectChartString>,
      isAdmin: true,
    };
  }

  const [reconciliation, periodRows, staffedRows] = await Promise.all([
    getReconciliation(termId),
    prisma.payPeriod.findMany({
      where: { termId },
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        name: true,
        term: { select: { code: true } },
        _count: { select: { entries: true } },
        imports: {
          where: { kind: "Timesheet" },
          orderBy: { uploadedAt: "desc" },
          take: 1,
          select: {
            uploadedAt: true,
            uploadedBy: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.project.findMany({
      where: { assignments: { some: { termId } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  // Inheriting the lab default is right for projects on the lab GL and wrong
  // for a sponsored project whose string nobody re-entered for the new term,
  // so only projects that had their own string before count as missing.
  const resolved = await resolveChartStringsForTerm(
    termId,
    staffedRows.map((p) => p.id),
  );
  const missingChartStrings: MissingChartString[] = staffedRows.flatMap((p) => {
    const lastOwnTermCode = resolved.get(p.id)?.lastOwnTermCode;
    return lastOwnTermCode ? [{ projectId: p.id, name: p.name, lastOwnTermCode }] : [];
  });
  const projectChartStrings: Record<string, ProjectChartString> = {};
  for (const [id, r] of resolved) {
    projectChartStrings[id] = { chartString: r.normalized, source: r.source };
  }

  const periods: PeriodSummary[] = periodRows.map((p) => {
    const imp = p.imports[0];
    return {
      id: p.id,
      name: p.name,
      termCode: p.term?.code ?? null,
      entries: p._count.entries,
      importedBy: imp
        ? `${imp.uploadedBy.firstName} ${imp.uploadedBy.lastName}`.trim()
        : null,
      importedAt: imp ? imp.uploadedAt.toISOString() : null,
    };
  });

  return {
    ...termFilter,
    reconciliation,
    periods,
    missingChartStrings,
    projectChartStrings,
    isAdmin: true,
  };
}

// Sets this term's chart string for a staffed project from the warning
// banner. Goes through the same write path as the project page, which
// validates, supersedes and audit-logs.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) {
    return Response.json({ ok: false, error: "Forbidden" } satisfies SetChartStringResult, { status: 403 });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "set-chart-string") {
    return Response.json({ ok: false, error: "Unknown intent" } satisfies SetChartStringResult, { status: 400 });
  }
  const projectId = String(form.get("projectId") ?? "").trim();
  const termId = String(form.get("termId") ?? "").trim();
  const chartString = String(form.get("chartString") ?? "").trim();
  if (!projectId || !termId) {
    return Response.json(
      { ok: false, projectId, error: "Missing project or term." } satisfies SetChartStringResult,
      { status: 400 },
    );
  }
  if (!chartString) {
    return Response.json(
      { ok: false, projectId, error: "Chart string is required." } satisfies SetChartStringResult,
      { status: 400 },
    );
  }

  const staffed = await prisma.project.findFirst({
    where: { id: projectId, assignments: { some: { termId } } },
    select: { id: true },
  });
  if (!staffed) {
    return Response.json(
      { ok: false, projectId, error: "That project isn't staffed this term." } satisfies SetChartStringResult,
      { status: 404 },
    );
  }

  try {
    const result = await recordProjectChartString({
      projectId,
      termId,
      chartString,
      createdById: auth.user.sub,
    });
    return Response.json({
      ok: true,
      projectId,
      chartString: result.normalized,
      warnings: result.warnings.map((w) => w.message),
    } satisfies SetChartStringResult);
  } catch (err) {
    if (err instanceof ChartStringValidationError) {
      return Response.json(
        { ok: false, projectId, error: err.message } satisfies SetChartStringResult,
        { status: 400 },
      );
    }
    throw err;
  }
}

type TabKey =
  | "summary"
  | "payroll-data"
  | "projects"
  | "chart-strings"
  | "discrepancies"
  | "external"
  | "budget";

export default function PayrollReconcile() {
  const data = useLoaderData<typeof loader>();
  const { panel, actionBtnPrimary, bodyText } = useOsChrome();
  const [tab, setTab] = useState<TabKey>("summary");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [chartWarningDismissed, setChartWarningDismissed] = useState(false);

  const rec = data.reconciliation;
  const discrepancyCount = rec
    ? rec.discrepancies.assignedNoHours.length +
      rec.discrepancies.unassignedJobs.length +
      rec.discrepancies.rateMismatches.length +
      rec.discrepancies.unknownPersons.length
    : 0;

  const csvHref = (view: TabKey) =>
    `/admin/payroll.csv?view=${view}&term=${data.selected}`;

  const hasData =
    rec !== null &&
    (rec.summary.totalHours > 0 || rec.summary.totalPay > 0);

  const tabs: { key: TabKey; label: string; badge?: string; alert?: boolean }[] = [
    { key: "summary", label: "Summary" },
    { key: "payroll-data", label: "Payroll Data" },
    { key: "projects", label: "Project Summaries" },
    { key: "chart-strings", label: "Chart Strings" },
    {
      key: "discrepancies",
      label: "Discrepancies",
      badge: discrepancyCount > 0 ? String(discrepancyCount) : undefined,
      alert: true,
    },
    {
      key: "external",
      label: "External",
      badge: rec && rec.external.totalHours > 0 ? `${rec.external.totalHours} hrs` : undefined,
    },
    { key: "budget", label: "Budget" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader
        section="payroll"
        actions={
          <>
            <TermFilter terms={data.terms} selected={data.selected} />
            <button type="button" className="os-add-btn py-2" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" strokeWidth={2.5} /> Import TimesheetX
            </button>
            {hasData && (
              <UiTooltip content="Export the current view as CSV">
                <a
                  href={csvHref(tab)}
                  download
                  data-discover="false"
                  aria-label="Export CSV"
                  className={actionBtnPrimary}
                >
                  <Download className="h-4 w-4" /> Export
                </a>
              </UiTooltip>
            )}
          </>
        }
      />

      <p className={cn(bodyText, "-mt-2")}>
        Headline totals are DALI only. External (non-DALI job IDs) is reported but excluded.
      </p>

      {data.missingChartStrings.length > 0 && !chartWarningDismissed && data.selected && (
        <ChartStringWarning
          projects={data.missingChartStrings}
          termId={data.selected}
          onDismiss={() => setChartWarningDismissed(true)}
        />
      )}

      {!hasData ? (
        <div className={cn(panel, "flex flex-col items-center px-6 py-12 text-center")}>
          <p className="font-semibold text-foreground">No timesheet data for this term yet</p>
          <p className="mt-1 text-sm text-os-muted">
            Upload a TimesheetX CSV export to reconcile actual hours against DALI OS staffing.
          </p>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="os-add-btn mt-5 py-2"
          >
            <Upload className="h-4 w-4" strokeWidth={2.5} /> Upload CSV
          </button>
        </div>
      ) : (
        <>
          <FiguresPanel rec={rec!} periods={data.periods} />

          <div className="flex flex-col gap-4">
            <div
              role="tablist"
              aria-label="Reconcile views"
              className="inline-flex max-w-full self-start overflow-x-auto rounded-full border border-border bg-muted/40 p-1"
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40",
                    tab === t.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.badge && (
                    <span
                      className={cn(
                        "tabular-nums",
                        t.alert ? "font-semibold text-os-amber" : "opacity-60",
                      )}
                    >
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div role="tabpanel">
              {tab === "summary" && <SummaryPanel rec={rec!} periods={data.periods} />}
              {tab === "payroll-data" && <PayrollDataPanel rec={rec!} />}
              {tab === "projects" && (
                <ProjectsPanel
                  rec={rec!}
                  chartStrings={data.projectChartStrings}
                  missing={data.missingChartStrings}
                  termId={data.selected}
                />
              )}
              {tab === "chart-strings" && <ChartStringsPanel rec={rec!} />}
              {tab === "discrepancies" && <DiscrepanciesPanel rec={rec!} />}
              {tab === "external" && <ExternalPanel rec={rec!} />}
              {tab === "budget" && <PayrollBudgetPanel term={data.selected} />}
            </div>
          </div>
        </>
      )}

      <PayrollUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}

// ─── Figures ─────────────────────────────────────────────────────────────────

function FiguresPanel({ rec, periods }: { rec: ReconciliationResult; periods: PeriodSummary[] }) {
  const { panel } = useOsChrome();
  const { summary } = rec;
  const lastImport = periods
    .filter((p) => p.importedAt)
    .sort((a, b) => (a.importedAt! < b.importedAt! ? 1 : -1))[0];
  const entries = periods.reduce((s, p) => s + p.entries, 0);

  return (
    <section
      aria-label="Totals"
      className={cn(panel, "grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]")}
    >
      <Figure size="lg" label="DALI hours" value={summary.daliHours.toLocaleString()} />
      <Figure size="lg" label="DALI payroll" value={formatUsd(summary.daliPay)} />
      <Figure
        size="lg"
        label="Students paid"
        value={summary.daliStudentCount.toLocaleString()}
        detail={`Median ${formatUsd(summary.medianPay)}`}
      />
      <Figure
        size="lg"
        label="External (excluded)"
        value={<span className="text-os-grey">{formatUsd(summary.externalPay)}</span>}
        detail={`${summary.externalHours.toLocaleString()} hrs`}
      />
      <div className="flex flex-col justify-center gap-2 text-sm lg:border-l lg:border-os-container/70 lg:pl-6">
        <p className="font-mono text-xs text-os-grey">
          <span className="text-foreground">DALI {formatUsd(summary.daliPay)}</span>
          {" + "}External {formatUsd(summary.externalPay)}
          {" = CSV total "}
          <span className="text-foreground">{formatUsd(summary.totalPay)}</span>
        </p>
        <p className="text-xs text-os-muted">
          {periods.length} pay period{periods.length === 1 ? "" : "s"} · {entries.toLocaleString()} entries
          {lastImport && (
            <>
              {" · "}Last import by {lastImport.importedBy ?? "unknown"},{" "}
              {new Date(lastImport.importedAt!).toLocaleDateString()}
            </>
          )}
        </p>
      </div>
    </section>
  );
}

// ─── Chart-string warning + inline entry ─────────────────────────────────────

function ChartStringWarning({
  projects,
  termId,
  onDismiss,
}: {
  projects: MissingChartString[];
  termId: string;
  onDismiss: () => void;
}) {
  const { iconBtn } = useOsChrome();
  return (
    <div role="alert" className="flex items-start gap-3 rounded-os-item bg-os-amber/10 px-4 py-3 text-sm text-os-amber">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {projects.length} staffed project{projects.length === 1 ? "" : "s"} with no chart string this term
        </p>
        <p className="mt-0.5">
          {projects.length === 1 ? "It" : "They"} had {projects.length === 1 ? "its own" : "their own"} in an
          earlier term and {projects.length === 1 ? "is" : "are"} now charging the lab default. Export still works.
          If the default is wrong, add this term's string.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.projectId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-semibold text-foreground">{p.name}</span>
              <span className="text-xs text-os-grey">Last own string in {p.lastOwnTermCode}</span>
              <ChartStringEntry projectId={p.projectId} projectName={p.name} termId={termId} />
            </li>
          ))}
        </ul>
      </div>
      <UiTooltip content="Dismiss">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss chart string warning"
          className={cn(iconBtn, "text-os-amber hover:text-os-amber")}
        >
          <X className="h-4 w-4" />
        </button>
      </UiTooltip>
    </div>
  );
}

function ChartStringEntry({
  projectId,
  projectName,
  termId,
}: {
  projectId: string;
  projectName: string;
  termId: string;
}) {
  const { compactField, actionBtnPrimary, actionBtn } = useOsChrome();
  const fetcher = useFetcher<SetChartStringResult>();
  const [editing, setEditing] = useState(false);
  const saving = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && result?.ok) setEditing(false);
  }, [fetcher.state, result]);

  if (result?.ok && !editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-xs">
        <Pill tone="ok">Saved</Pill>
        <span className="font-mono text-foreground">{result.chartString}</span>
        {result.warnings.length > 0 && <span className="text-os-amber">{result.warnings.join(" ")}</span>}
      </span>
    );
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="transition-opacity hover:opacity-80">
        <Pill tone="warn">Missing · Add</Pill>
      </button>
    );
  }

  return (
    <fetcher.Form method="post" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="intent" value="set-chart-string" />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="termId" value={termId} />
      <input
        name="chartString"
        autoFocus
        required
        placeholder="Chart string"
        aria-label={`Chart string for ${projectName}`}
        className={cn(compactField, "w-60 border border-os-container px-3 py-1.5 font-mono text-xs")}
      />
      <button type="submit" disabled={saving} className={cn(actionBtnPrimary, "disabled:opacity-50")}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className={actionBtn()}>
        Cancel
      </button>
      {result && !result.ok && <span className="w-full text-xs text-destructive">{result.error}</span>}
    </fetcher.Form>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const TH = adminTable.th;
const TH_NUM = cn(adminTable.th, "text-right");
const TD = cn(adminTable.td, "text-os-grey");
const TD_NUM = cn(adminTable.td, "text-right tabular-nums text-foreground");
const TD_PRIMARY = cn(adminTable.td, "font-semibold text-foreground");

function PanelEmpty({ children }: { children: ReactNode }) {
  const { panel } = useOsChrome();
  return (
    <div className={panel}>
      <EmptyState>{children}</EmptyState>
    </div>
  );
}

function Footnote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-os-muted">{children}</p>;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function SummaryPanel({
  rec,
  periods,
}: {
  rec: ReconciliationResult;
  periods: PeriodSummary[];
}) {
  const { panel, sectionTitle } = useOsChrome();

  const chartData = useMemo(
    () =>
      [...rec.projects]
        .sort((a, b) => b.totalHours - a.totalHours)
        .map((p) => ({ name: p.projectName, hours: p.totalHours })),
    [rec.projects],
  );

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Pay periods</h2>
        <div className={adminTable.wrap}>
          {periods.length === 0 ? (
            <EmptyState>No pay periods for this term.</EmptyState>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Period</th>
                  <th className={TH}>Term</th>
                  <th className={TH_NUM}>Entries</th>
                  <th className={TH}>Imported by</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className={adminTable.row}>
                    <td className={cn(TD_PRIMARY, "font-mono text-xs")}>{p.name}</td>
                    <td className={TD}>{p.termCode ? <Pill>{p.termCode}</Pill> : "—"}</td>
                    <td className={TD_NUM}>{p.entries.toLocaleString()}</td>
                    <td className={TD}>
                      {p.importedBy ?? "—"}
                      {p.importedAt && (
                        <span className="text-os-muted">
                          {" · "}
                          {new Date(p.importedAt).toLocaleDateString()}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {chartData.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>Hours by project</h2>
          <div className={cn(panel, "p-5")}>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 12, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="var(--color-os-container)" />
                  <XAxis type="number" tick={{ fontSize: 12, fill: "var(--color-os-muted)" }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-os-container)", opacity: 0.4 }}
                    contentStyle={{
                      backgroundColor: "var(--color-os-card)",
                      border: "1px solid var(--color-os-container)",
                      borderRadius: 10,
                      color: "var(--color-foreground)",
                    }}
                  />
                  <Bar dataKey="hours" fill="var(--color-os-accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Payroll Data ────────────────────────────────────────────────────────────

type SortKey = "name" | "hours" | "pay";

type FlatJob = JobBreakdown & { projects: string };

function PayrollDataPanel({ rec }: { rec: ReconciliationResult }) {
  const { iconBtn } = useOsChrome();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("hours");
  const [notesFor, setNotesFor] = useState<FlatJob | null>(null);

  const notesByJobKey = rec.notesByJobKey;
  const notesForJob = (j: { netId: string; jobId: string }): TimesheetNoteView[] =>
    notesByJobKey[`${j.netId}::${j.jobId}`] ?? [];

  const jobs = useMemo<FlatJob[]>(() => {
    const flat: FlatJob[] = [];
    for (const p of rec.projects) {
      for (const j of p.jobs) {
        flat.push({ ...j, projects: p.projectName });
      }
    }
    for (const j of rec.core.jobs) flat.push({ ...j, projects: "Core" });
    for (const j of rec.instructor.jobs) flat.push({ ...j, projects: "Instructor" });
    return flat;
  }, [rec]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? jobs.filter(
          (j) =>
            j.name.toLowerCase().includes(q) ||
            j.netId.toLowerCase().includes(q) ||
            j.jobId.toLowerCase().includes(q),
        )
      : jobs;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "hours") return b.hours - a.hours;
      return b.pay - a.pay;
    });
  }, [jobs, query, sortKey]);

  const SortableTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th className={k === "name" ? TH : TH_NUM} aria-sort={sortKey === k ? (k === "name" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => setSortKey(k)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", sortKey === k && "text-foreground")}
      >
        {label}
        {sortKey === k && <span className="text-os-accent">↓</span>}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search students…"
        containerClassName="max-w-xs"
      />
      <div className={adminTable.wrap}>
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <SortableTh label="Student" k="name" />
              <th className={TH}>NetID</th>
              <th className={TH}>Job</th>
              <th className={TH}>Project(s)</th>
              <SortableTh label="Hours" k="hours" />
              <SortableTh label="Earnings" k="pay" />
              <th className={TH_NUM}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className={adminTable.row}>
                <td colSpan={7}>
                  <EmptyState>No matching rows.</EmptyState>
                </td>
              </tr>
            )}
            {rows.map((j, i) => {
              const count = notesForJob(j).length;
              return (
                <tr key={`${j.netId}-${j.jobId}-${i}`} className={adminTable.row}>
                  <td className={TD_PRIMARY}>{j.name}</td>
                  <td className={cn(TD, "font-mono text-xs")}>{j.netId}</td>
                  <td className={TD}>
                    <span className="font-mono text-xs text-foreground">{j.jobId}</span> {j.jobTitle}
                  </td>
                  <td className={TD}>
                    {j.projects}
                    {j.sharedWith.length > 0 && (
                      <Pill className="ml-1.5">Shared: {j.sharedWith.join(", ")}</Pill>
                    )}
                  </td>
                  <td className={TD_NUM}>{j.hours.toLocaleString()}</td>
                  <td className={TD_NUM}>{formatUsd(j.pay)}</td>
                  <td className={cn(adminTable.td, "text-right")}>
                    <UiTooltip content={count > 0 ? `${count} note${count === 1 ? "" : "s"}` : "No notes"}>
                      <button
                        type="button"
                        onClick={() => setNotesFor(j)}
                        aria-label={`View notes for ${j.name}`}
                        className={cn(iconBtn, "inline-flex items-center gap-1", count > 0 ? "text-os-accent" : "text-os-muted")}
                      >
                        <StickyNote className="h-4 w-4" />
                        {count > 0 && <span className="text-[11px] font-bold tabular-nums">{count}</span>}
                      </button>
                    </UiTooltip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Footnote>
        Earnings are always the sum of Total_Earnings from the timesheet. The assignment wage is display only.
      </Footnote>

      <NotesModal job={notesFor} notes={notesFor ? notesForJob(notesFor) : []} onClose={() => setNotesFor(null)} />
    </div>
  );
}

function NotesModal({
  job,
  notes,
  onClose,
}: {
  job: FlatJob | null;
  notes: TimesheetNoteView[];
  onClose: () => void;
}) {
  return (
    <Modal open={job !== null} onClose={onClose} labelledBy="notes-modal-title">
      <ModalHeader
        titleId="notes-modal-title"
        title="Notes"
        subtitle={job ? `${job.name} · ${job.jobId}` : undefined}
        onClose={onClose}
      />
      {notes.length === 0 ? (
        <p className="text-sm text-os-muted">No notes recorded for this person and job.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((n, i) => (
            <li key={i} className="rounded-os-item bg-os-well px-3.5 py-3 text-sm">
              <p className="whitespace-pre-wrap text-foreground">{n.note}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-os-muted">
                <span className="font-mono">{n.payPeriodName}</span>
                {n.validatedChartstring && <span className="font-mono">· {n.validatedChartstring}</span>}
                {n.linkToTimesheet && (
                  <a
                    href={n.linkToTimesheet}
                    target="_blank"
                    rel="noreferrer"
                    className="text-os-accent underline hover:text-os-accent-hover"
                  >
                    Timesheet
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ─── Project Summaries ───────────────────────────────────────────────────────

function ProjectsPanel({
  rec,
  chartStrings,
  missing,
  termId,
}: {
  rec: ReconciliationResult;
  chartStrings: Record<string, ProjectChartString>;
  missing: MissingChartString[];
  termId: string;
}) {
  const projects = [...rec.projects].sort((a, b) => b.totalHours - a.totalHours);
  const missingIds = new Set(missing.map((m) => m.projectId));
  const totalStudents = new Set(projects.flatMap((p) => p.jobs.map((j) => j.netId))).size;
  const totalHours = projects.reduce((s, p) => s + p.totalHours, 0);
  const totalShared = projects.reduce((s, p) => s + p.sharedHours, 0);
  const totalPay = projects.reduce((s, p) => s + p.totalPay, 0);

  if (projects.length === 0) {
    return (
      <PanelEmpty>
        No project-attributed hours this term. Uploaded hours may be Core, Instructor, or External. See those views.
      </PanelEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={adminTable.wrap}>
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className={TH}>Project</th>
              <th className={TH}>Chart string</th>
              <th className={TH_NUM}>Students</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH_NUM}>Of which shared</th>
              <th className={TH_NUM}>Earnings</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const students = new Set(p.jobs.map((j) => j.netId)).size;
              const cs = chartStrings[p.projectId];
              return (
                <tr key={p.projectId} className={adminTable.row}>
                  <td className={TD_PRIMARY}>{p.projectName}</td>
                  <td className={TD}>
                    {missingIds.has(p.projectId) && termId ? (
                      <ChartStringEntry projectId={p.projectId} projectName={p.projectName} termId={termId} />
                    ) : cs ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-xs">{cs.chartString}</span>
                        {cs.source !== "project" && <span className="text-xs text-os-muted">Lab default</span>}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={TD_NUM}>{students}</td>
                  <td className={TD_NUM}>{p.totalHours.toLocaleString()}</td>
                  <td className={TD_NUM}>{p.sharedHours.toLocaleString()}</td>
                  <td className={TD_NUM}>{formatUsd(p.totalPay)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-os-container">
              <td className={TD_PRIMARY} colSpan={2}>
                Grand total (DALI projects)
              </td>
              <td className={cn(TD_NUM, "font-semibold")}>{totalStudents}</td>
              <td className={cn(TD_NUM, "font-semibold")}>{totalHours.toLocaleString()}</td>
              <td className={cn(TD_NUM, "font-semibold")}>{totalShared.toLocaleString()}</td>
              <td className={cn(TD_NUM, "font-semibold")}>{formatUsd(totalPay)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <Footnote>
        A person on several projects counts full hours on each, never divided. "Of which shared" counts those hours.
        Core and Instructor hours are not project attributed.
      </Footnote>
    </div>
  );
}

// ─── Chart Strings ───────────────────────────────────────────────────────────

function ChartStringsPanel({ rec }: { rec: ReconciliationResult }) {
  const { iconBtn } = useOsChrome();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (cs: string) => {
    const next = new Set(open);
    if (next.has(cs)) next.delete(cs);
    else next.add(cs);
    setOpen(next);
  };

  if (rec.chartStrings.length === 0) {
    return <PanelEmpty>No chart strings charged this term.</PanelEmpty>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={adminTable.wrap}>
        <table className="w-full min-w-[640px]">
          <thead>
            <tr>
              <th className={cn(TH, "w-10")}>
                <span className="sr-only">Expand</span>
              </th>
              <th className={TH}>
                <span className="inline-flex items-center gap-1">
                  Chart string
                  <InfoTip content="The Dartmouth financial account code (oracle chart string) that payroll charges are posted to for each project." />
                </span>
              </th>
              <th className={TH}>Project</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH_NUM}>Earnings</th>
            </tr>
          </thead>
          <tbody>
            {rec.chartStrings.map((cs) => {
              const isOpen = open.has(cs.chartString);
              return (
                <Fragment key={cs.chartString}>
                  <tr className={cn(adminTable.row, "cursor-pointer")} onClick={() => toggle(cs.chartString)}>
                    <td className={adminTable.td}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(cs.chartString);
                        }}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                        aria-expanded={isOpen}
                        className={iconBtn}
                      >
                        <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                      </button>
                    </td>
                    <td className={cn(TD_PRIMARY, "font-mono text-xs")}>{cs.chartString}</td>
                    <td className={TD}>
                      {cs.projects.length === 0 ? (
                        <Pill tone="idle">No project</Pill>
                      ) : (
                        <>
                          {cs.projects.map((p) => p.name).join(", ")}
                          {cs.ambiguousProject && (
                            <Pill tone="warn" className="ml-1.5">
                              Ambiguous
                            </Pill>
                          )}
                        </>
                      )}
                    </td>
                    <td className={TD_NUM}>{cs.totalHours.toLocaleString()}</td>
                    <td className={TD_NUM}>{formatUsd(cs.totalPay)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={5} className="bg-os-well/60 px-6 py-2">
                        <table className="w-full">
                          <thead>
                            <tr>
                              <th className={TH}>Student</th>
                              <th className={TH}>NetID</th>
                              <th className={TH_NUM}>Hours</th>
                              <th className={TH_NUM}>Earnings</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cs.students.map((s) => (
                              <tr key={s.netId} className={adminTable.row}>
                                <td className={TD_PRIMARY}>{s.name}</td>
                                <td className={cn(TD, "font-mono text-xs")}>{s.netId}</td>
                                <td className={TD_NUM}>{s.hours.toLocaleString()}</td>
                                <td className={TD_NUM}>{formatUsd(s.pay)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Footnote>
        Grouped by the charged chart string. Normalization ignores the drifting first segment, so the same downstream
        account collapses to one project.
      </Footnote>
    </div>
  );
}

// ─── Discrepancies ───────────────────────────────────────────────────────────

function DiscrepanciesPanel({ rec }: { rec: ReconciliationResult }) {
  const d = rec.discrepancies;
  const total =
    d.assignedNoHours.length + d.unassignedJobs.length + d.rateMismatches.length + d.unknownPersons.length;

  if (total === 0) {
    return <PanelEmpty>No discrepancies for this term. Actuals reconcile cleanly against staffing.</PanelEmpty>;
  }

  return (
    <div className="flex flex-col gap-6">
      <DiscCard title="Assigned, but no hours" count={d.assignedNoHours.length}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Student</th>
              <th className={TH}>Project</th>
            </tr>
          </thead>
          <tbody>
            {d.assignedNoHours.map((x, i) => (
              <tr key={`${x.netId}-${i}`} className={adminTable.row}>
                <td className={TD_PRIMARY}>{x.name}</td>
                <td className={TD}>{x.projectName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiscCard>

      <DiscCard title="DALI job with no matching assignment" count={d.unassignedJobs.length}>
        <table className="w-full min-w-[640px]">
          <thead>
            <tr>
              <th className={TH}>Student</th>
              <th className={TH}>NetID</th>
              <th className={TH}>Job</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH}>Inferred project</th>
            </tr>
          </thead>
          <tbody>
            {d.unassignedJobs.map((x, i) => (
              <tr key={`${x.netId}-${i}`} className={adminTable.row}>
                <td className={TD_PRIMARY}>{x.name}</td>
                <td className={cn(TD, "font-mono text-xs")}>{x.netId}</td>
                <td className={cn(TD, "font-mono text-xs")}>{x.jobId}</td>
                <td className={TD_NUM}>{x.hours.toLocaleString()}</td>
                <td className={TD}>{x.inferredProjectName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiscCard>

      <DiscCard
        title="Rate mismatch"
        count={d.rateMismatches.length}
        footer={
          <>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Shown only for the active term. There is no wage history, so comparing past terms against today's lookup
            rates would show false mismatches.
          </>
        }
      >
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={TH}>Student</th>
              <th className={TH}>Job</th>
              <th className={TH_NUM}>Earnings</th>
              <th className={TH_NUM}>Expected</th>
              <th className={TH_NUM}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {d.rateMismatches.map((x, i) => (
              <tr key={`${x.netId}-${i}`} className={adminTable.row}>
                <td className={TD_PRIMARY}>{x.name}</td>
                <td className={cn(TD, "font-mono text-xs")}>{x.jobId}</td>
                <td className={TD_NUM}>{formatUsd(x.actualPay)}</td>
                <td className={TD_NUM}>{formatUsd(x.expectedPay)}</td>
                <td className={cn(TD_NUM, x.difference < 0 && "font-semibold text-destructive")}>
                  {x.difference < 0 ? "−" : "+"}
                  {formatUsd(Math.abs(x.difference))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiscCard>

      <DiscCard title="Unknown person" count={d.unknownPersons.length}>
        <table className="w-full min-w-[640px]">
          <thead>
            <tr>
              <th className={TH}>NetID</th>
              <th className={TH}>Name on timesheet</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH_NUM}>Earnings</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {d.unknownPersons.map((x, i) => (
              <tr key={`${x.netId}-${i}`} className={adminTable.row}>
                <td className={cn(TD_PRIMARY, "font-mono text-xs")}>{x.netId}</td>
                <td className={TD}>{x.name}</td>
                <td className={TD_NUM}>{x.hours.toLocaleString()}</td>
                <td className={TD_NUM}>{formatUsd(x.pay)}</td>
                <td className={TD}>
                  <Pill tone="bad">Not in DALI OS, still counted</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiscCard>
    </div>
  );
}

function DiscCard({
  title,
  count,
  footer,
  children,
}: {
  title: string;
  count: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { panel } = useOsChrome();
  if (count === 0) return null;
  return (
    <section className={cn(panel, "overflow-hidden")}>
      <div className="flex items-center gap-2 px-6 py-4">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <Pill tone="warn">{count}</Pill>
      </div>
      <div className="overflow-x-auto">{children}</div>
      {footer && (
        <div className="flex items-start gap-2 border-t border-os-container/70 px-6 py-3 text-xs text-os-muted">
          {footer}
        </div>
      )}
    </section>
  );
}

// ─── External ────────────────────────────────────────────────────────────────

function ExternalPanel({ rec }: { rec: ReconciliationResult }) {
  const { panel } = useOsChrome();
  const [open, setOpen] = useState(false);
  const ext = rec.external;
  const people = new Set(ext.jobs.map((j) => j.netId)).size;

  return (
    <div className="flex flex-col gap-3">
      <section className={cn(panel, "overflow-hidden")}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-6 py-4 text-left"
        >
          <ChevronRight className={cn("h-4 w-4 text-os-grey transition-transform", open && "rotate-90")} />
          <span className="flex-1 text-sm font-semibold text-foreground">
            External, not DALI: {people} people · {ext.totalHours.toLocaleString()} hrs · {formatUsd(ext.totalPay)}{" "}
            <span className="font-normal text-os-muted">(excluded from DALI totals)</span>
          </span>
        </button>
        {open && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className={TH}>NetID</th>
                  <th className={TH}>Name</th>
                  <th className={TH}>Job</th>
                  <th className={TH_NUM}>Hours</th>
                  <th className={TH_NUM}>Earnings</th>
                </tr>
              </thead>
              <tbody>
                {ext.jobs.map((j, i) => (
                  <tr key={`${j.netId}-${j.jobId}-${i}`} className={adminTable.row}>
                    <td className={cn(TD, "font-mono text-xs")}>{j.netId}</td>
                    <td className={TD_PRIMARY}>{j.name}</td>
                    <td className={TD}>
                      <span className="font-mono text-xs text-foreground">{j.jobId}</span> {j.jobTitle}
                    </td>
                    <td className={TD_NUM}>{j.hours.toLocaleString()}</td>
                    <td className={TD_NUM}>{formatUsd(j.pay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Footnote>
        Job IDs that match no JobCodeLookup row land here. It is a bucket, never a discrepancy. Their earnings are shown
        but excluded from every DALI total.
      </Footnote>
    </div>
  );
}
