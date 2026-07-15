import { Fragment, useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.payroll";
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
  Wallet,
  Download,
  Upload,
  ChevronRight,
  StickyNote,
  AlertTriangle,
  Info,
  X,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { resolveTermFilter } from "~/lib/terms";
import {
  getReconciliation,
  type ReconciliationResult,
  type TimesheetNoteView,
} from "~/admin-console/lib/payroll-reconcile.server";
import type { JobBreakdown } from "~/admin-console/lib/payroll-collation";
import { adminPills } from "~/admin-console/adminPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { TermFilter } from "~/components/TermFilter";
import { Card } from "~/components/ui/Card";
import { buttonClasses } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import { Modal, ModalHeader } from "~/components/Modal";
import { formatUsd } from "~/lib/money";
import { cn } from "~/lib/cn";
import { useChartColors } from "~/components/analytics/useChartColors";
import { PayrollUploadModal } from "~/admin-console/components/PayrollUploadModal";
import { PayrollBudgetPanel } from "~/admin-console/components/PayrollBudgetPanel";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Payroll: Reconcile · Admin · DALI OS" },
];

export type PeriodSummary = {
  id: string;
  name: string;
  termCode: string | null;
  entries: number;
  importedBy: string | null;
  importedAt: string | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const termFilter = await resolveTermFilter(request);
  const { termId } = termFilter;

  if (!termId) {
    return {
      ...termFilter,
      reconciliation: null as ReconciliationResult | null,
      periods: [] as PeriodSummary[],
      missingChartStrings: [] as string[],
    };
  }

  const [reconciliation, periodRows, missingChartRows] = await Promise.all([
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
    // DALI projects staffed this term whose chart string is missing/blank: the
    // chart-string tie-break can't attribute their hours to one project, so
    // warn staff to fill it in.
    prisma.project.findMany({
      where: {
        assignments: { some: { termId } },
        OR: [{ chartString: null }, { chartString: "" }],
      },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);
  const missingChartStrings = missingChartRows.map((p) => p.name);

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

  return { ...termFilter, reconciliation, periods, missingChartStrings };
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
    `/admin-console/payroll.csv?view=${view}&term=${data.selected}`;

  const hasData =
    rec !== null &&
    (rec.summary.totalHours > 0 || rec.summary.totalPay > 0);

  const tabs: { key: TabKey; label: string; badge?: string; badgeTone?: "coral" | "muted" }[] = [
    { key: "summary", label: "Summary" },
    { key: "payroll-data", label: "Payroll Data" },
    { key: "projects", label: "Project Summaries" },
    { key: "chart-strings", label: "Chart Strings" },
    {
      key: "discrepancies",
      label: "Discrepancies",
      badge: discrepancyCount > 0 ? String(discrepancyCount) : undefined,
      badgeTone: "coral",
    },
    {
      key: "external",
      label: "External",
      badge: rec && rec.external.totalHours > 0 ? `${rec.external.totalHours} hrs` : undefined,
      badgeTone: "muted",
    },
    { key: "budget", label: "Budget" },
  ];

  return (
    <div className="space-y-6">
      <AreaPillNav items={adminPills({ isAdmin: true, active: "payroll-reconcile" })} />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="w-6 h-6 text-foreground/80" />
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Payroll: Reconcile
          </h1>
          {data.periods.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {data.periods.length} pay period{data.periods.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TermFilter terms={data.terms} selected={data.selected} />
          {hasData && (
            <a
              href={csvHref(tab)}
              download
              data-discover="false"
              className={buttonClasses("secondary", "sm")}
            >
              <Download className="w-4 h-4" /> Export CSV
            </a>
          )}
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className={buttonClasses("primary", "sm")}
          >
            <Upload className="w-4 h-4" /> Upload CSV
          </button>
        </div>
      </header>

      <p className="text-sm text-muted-foreground">
        Reconcile TimesheetX actuals against DALI OS staffing. Headline totals
        are DALI-only; External (non-DALI job IDs) is reported but excluded.
      </p>

      {data.missingChartStrings.length > 0 && !chartWarningDismissed && (
        <ChartStringWarning
          projects={data.missingChartStrings}
          onDismiss={() => setChartWarningDismissed(true)}
        />
      )}

      {!hasData ? (
        <EmptyState onUpload={() => setUploadOpen(true)} />
      ) : (
        <>
          <div
            role="tablist"
            className="flex gap-1 border-b border-border overflow-x-auto"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium -mb-px border-b-2",
                  tab === t.key
                    ? "border-accent-coral text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.badge && (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[11px] font-bold",
                      t.badgeTone === "coral"
                        ? "bg-accent-coral text-white"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div>
            {tab === "summary" && (
              <SummaryPanel rec={rec!} periods={data.periods} />
            )}
            {tab === "payroll-data" && <PayrollDataPanel rec={rec!} />}
            {tab === "projects" && <ProjectsPanel rec={rec!} />}
            {tab === "chart-strings" && <ChartStringsPanel rec={rec!} />}
            {tab === "discrepancies" && <DiscrepanciesPanel rec={rec!} />}
            {tab === "external" && <ExternalPanel rec={rec!} />}
            {tab === "budget" && <PayrollBudgetPanel term={data.selected} />}
          </div>
        </>
      )}

      <PayrollUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <Card className="p-10 text-center">
      <Wallet className="mx-auto w-8 h-8 text-muted-foreground/60" />
      <h2 className="mt-3 font-heading text-lg font-semibold text-foreground">
        No timesheet data for this term yet
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a TimesheetX CSV export to reconcile actual hours against DALI OS
        staffing.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className={cn(buttonClasses("primary", "sm"), "mt-4")}
      >
        <Upload className="w-4 h-4" /> Upload CSV
      </button>
    </Card>
  );
}

// ─── Chart-string-missing warning ────────────────────────────────────────────

function ChartStringWarning({
  projects,
  onDismiss,
}: {
  projects: string[];
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0 text-amber-600" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">
          {projects.length} staffed project{projects.length === 1 ? "" : "s"} missing a
          chart string
        </p>
        <p className="mt-0.5 text-amber-800">
          Hours can't be tie-broken to {projects.length === 1 ? "it" : "them"} by chart
          string — set one on {projects.join(", ")} in the project settings.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss chart string warning"
        className="text-amber-600 hover:text-amber-900"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Shared table chrome ─────────────────────────────────────────────────────

const TABLE_WRAP = "bg-card border border-border rounded-lg overflow-x-auto";
const TH = "text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap";
const TH_NUM = "text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap";
const TD = "px-3 py-2 text-muted-foreground";
const TD_NUM = "px-3 py-2 text-right text-muted-foreground tabular-nums";
const TD_PRIMARY = "px-3 py-2 text-foreground font-medium";

// ─── Summary ─────────────────────────────────────────────────────────────────

function SummaryPanel({
  rec,
  periods,
}: {
  rec: ReconciliationResult;
  periods: PeriodSummary[];
}) {
  const colors = useChartColors();
  const { summary } = rec;

  const chartData = useMemo(
    () =>
      [...rec.projects]
        .sort((a, b) => b.totalHours - a.totalHours)
        .map((p) => ({ name: p.projectName, hours: p.totalHours })),
    [rec.projects],
  );

  return (
    <div className="space-y-7">
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        <StatCard label="DALI hours" value={summary.daliHours.toLocaleString()} />
        <StatCard label="DALI payroll" value={formatUsd(summary.daliPay)} />
        <StatCard
          label="Students paid"
          value={summary.daliStudentCount.toLocaleString()}
          sub={`median ${formatUsd(summary.medianPay)}`}
        />
        <StatCard
          label="External (excluded)"
          value={formatUsd(summary.externalPay)}
          sub={`${summary.externalHours.toLocaleString()} hrs`}
          muted
        />
      </div>

      <Card className="px-4 py-3 text-sm">
        <span className="font-mono text-xs">
          <span className="text-dark-blue">DALI {formatUsd(summary.daliPay)}</span>
          {" + "}
          <span className="text-muted-foreground">
            External {formatUsd(summary.externalPay)}
          </span>
          {" = CSV total "}
          {formatUsd(summary.totalPay)}
        </span>
      </Card>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Pay periods
        </h2>
        <div className={TABLE_WRAP}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className={TH}>Period</th>
                <th className={TH}>Term</th>
                <th className={TH_NUM}>Entries</th>
                <th className={TH}>Imported by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {periods.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground/70">
                    No pay periods for this term.
                  </td>
                </tr>
              )}
              {periods.map((p) => (
                <tr key={p.id} className="hover:bg-muted/50">
                  <td className={cn(TD_PRIMARY, "font-mono")}>{p.name}</td>
                  <td className={TD}>
                    {p.termCode ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                        {p.termCode}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={TD_NUM}>{p.entries.toLocaleString()}</td>
                  <td className={TD}>
                    {p.importedBy ?? "—"}
                    {p.importedAt && (
                      <span className="text-muted-foreground/60">
                        {" · "}
                        {new Date(p.importedAt).toLocaleDateString()}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {chartData.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-semibold text-foreground">
            Hours by project
          </h2>
          <Card className="p-4">
            <div className="w-full h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ left: 12, right: 16, top: 4, bottom: 4 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-muted)" }}
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      color: "var(--color-foreground)",
                    }}
                  />
                  <Bar dataKey="hours" fill={colors.coral} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-3xl font-bold tabular-nums leading-tight",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground/70">{sub}</div>}
    </Card>
  );
}

// ─── Payroll Data ────────────────────────────────────────────────────────────

type SortKey = "name" | "hours" | "pay";

type FlatJob = JobBreakdown & { projects: string };

function PayrollDataPanel({ rec }: { rec: ReconciliationResult }) {
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
    for (const j of rec.core.jobs) flat.push({ ...j, projects: "— Core" });
    for (const j of rec.instructor.jobs) flat.push({ ...j, projects: "— Instructor" });
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
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "hours") return b.hours - a.hours;
      return b.pay - a.pay;
    });
    return sorted;
  }, [jobs, query, sortKey]);

  const SortableTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th className={k === "name" ? TH : TH_NUM}>
      <button
        type="button"
        onClick={() => setSortKey(k)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {sortKey === k && <span className="text-accent-coral">↓</span>}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search students…"
        containerClassName="max-w-xs"
      />
      <div className={TABLE_WRAP}>
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <SortableTh label="Student" k="name" />
              <th className={TH}>NetID</th>
              <th className={TH}>Job</th>
              <th className={TH}>Project(s)</th>
              <SortableTh label="Hours" k="hours" />
              <SortableTh label="Earnings" k="pay" />
              <th className={TH}>Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground/70">
                  No matching rows.
                </td>
              </tr>
            )}
            {rows.map((j, i) => (
              <tr key={`${j.netId}-${j.jobId}-${i}`} className="hover:bg-muted/50">
                <td className={TD_PRIMARY}>{j.name}</td>
                <td className={cn(TD, "font-mono")}>{j.netId}</td>
                <td className={TD}>
                  <span className="font-mono">{j.jobId}</span> {j.jobTitle}
                </td>
                <td className={TD}>
                  {j.projects}
                  {j.sharedWith.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-purple-100 text-purple-800">
                      shared: {j.sharedWith.join(", ")}
                    </span>
                  )}
                </td>
                <td className={TD_NUM}>{j.hours.toLocaleString()}</td>
                <td className={TD_NUM}>{formatUsd(j.pay)}</td>
                <td className="px-3 py-2 text-right">
                  {(() => {
                    const count = notesForJob(j).length;
                    return (
                      <button
                        type="button"
                        onClick={() => setNotesFor(j)}
                        aria-label={`View notes for ${j.name}`}
                        className={cn(
                          "inline-flex items-center gap-1",
                          count > 0
                            ? "text-accent-coral hover:text-accent-coral/80"
                            : "text-muted-foreground/40 hover:text-foreground",
                        )}
                      >
                        <StickyNote className="w-4 h-4" />
                        {count > 0 && (
                          <span className="text-[10px] font-bold tabular-nums">{count}</span>
                        )}
                      </button>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Earnings are always Σ Total_Earnings from the timesheet; the assignment
        wage is display-only.
      </p>

      <NotesModal
        job={notesFor}
        notes={notesFor ? notesForJob(notesFor) : []}
        onClose={() => setNotesFor(null)}
      />
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
  const open = job !== null;
  return (
    <Modal open={open} onClose={onClose} labelledBy="notes-modal-title">
      <ModalHeader
        titleId="notes-modal-title"
        title="Notes"
        subtitle={job ? `${job.name} · ${job.jobId}` : undefined}
        onClose={onClose}
      />
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No notes recorded for this person-job.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n, i) => (
            <li
              key={i}
              className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm"
            >
              <p className="whitespace-pre-wrap text-foreground">{n.note}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{n.payPeriodName}</span>
                {n.validatedChartstring && (
                  <span className="font-mono">· {n.validatedChartstring}</span>
                )}
                {n.linkToTimesheet && (
                  <a
                    href={n.linkToTimesheet}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-coral underline hover:text-accent-coral/80"
                  >
                    timesheet
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

function ProjectsPanel({ rec }: { rec: ReconciliationResult }) {
  const projects = [...rec.projects].sort((a, b) => b.totalHours - a.totalHours);
  const totalStudents = new Set(
    projects.flatMap((p) => p.jobs.map((j) => j.netId)),
  ).size;
  const totalHours = projects.reduce((s, p) => s + p.totalHours, 0);
  const totalShared = projects.reduce((s, p) => s + p.sharedHours, 0);
  const totalPay = projects.reduce((s, p) => s + p.totalPay, 0);

  if (projects.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        No project-attributed hours this term. Uploaded hours may be Core,
        Instructor, or External — see those tabs.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className={TABLE_WRAP}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={TH}>Project</th>
              <th className={TH_NUM}>Students</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH_NUM}>of which shared</th>
              <th className={TH_NUM}>Earnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {projects.map((p) => {
              const students = new Set(p.jobs.map((j) => j.netId)).size;
              return (
                <tr key={p.projectId} className="hover:bg-muted/50">
                  <td className={TD_PRIMARY}>{p.projectName}</td>
                  <td className={TD_NUM}>{students}</td>
                  <td className={TD_NUM}>{p.totalHours.toLocaleString()}</td>
                  <td className={TD_NUM}>{p.sharedHours.toLocaleString()}</td>
                  <td className={TD_NUM}>{formatUsd(p.totalPay)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-foreground font-bold text-foreground">
              <td className="px-3 py-2">Grand total (DALI projects)</td>
              <td className={cn(TD_NUM, "text-foreground font-bold")}>{totalStudents}</td>
              <td className={cn(TD_NUM, "text-foreground font-bold")}>
                {totalHours.toLocaleString()}
              </td>
              <td className={cn(TD_NUM, "text-foreground font-bold")}>
                {totalShared.toLocaleString()}
              </td>
              <td className={cn(TD_NUM, "text-foreground font-bold")}>
                {formatUsd(totalPay)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs italic text-muted-foreground">
        A person on several projects contributes full hours to each, never
        divided — "of which shared" counts those hours. Core/Instructor hours
        are not project-attributed.
      </p>
    </div>
  );
}

// ─── Chart Strings ───────────────────────────────────────────────────────────

function ChartStringsPanel({ rec }: { rec: ReconciliationResult }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (cs: string) => {
    const next = new Set(open);
    if (next.has(cs)) next.delete(cs);
    else next.add(cs);
    setOpen(next);
  };

  if (rec.chartStrings.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        No chart strings charged this term.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className={TABLE_WRAP}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="w-8 px-3 py-2"></th>
              <th className={TH}>Chart String</th>
              <th className={TH}>Project</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH_NUM}>Earnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rec.chartStrings.map((cs) => {
              const isOpen = open.has(cs.chartString);
              return (
                <Fragment key={cs.chartString}>
                  <tr className="hover:bg-muted/50">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggle(cs.chartString)}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                        className="text-muted-foreground"
                      >
                        <ChevronRight
                          className={cn(
                            "w-4 h-4 transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                      </button>
                    </td>
                    <td className={cn(TD_PRIMARY, "font-mono")}>{cs.chartString}</td>
                    <td className={TD}>
                      {cs.projects.length === 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                          — no project
                        </span>
                      ) : (
                        <>
                          {cs.projects.map((p) => p.name).join(", ")}
                          {cs.ambiguousProject && (
                            <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-50 text-amber-700">
                              <AlertTriangle className="w-3 h-3" /> ambiguous
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className={TD_NUM}>{cs.totalHours.toLocaleString()}</td>
                    <td className={TD_NUM}>{formatUsd(cs.totalPay)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={5} className="bg-muted/30 px-3 py-3">
                        <table className="w-full text-xs">
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
                              <tr key={s.netId}>
                                <td className={TD_PRIMARY}>{s.name}</td>
                                <td className={cn(TD, "font-mono")}>{s.netId}</td>
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
      <p className="text-xs text-muted-foreground">
        Grouped by the charged chart string. Suffix-normalization ignores the
        drifting first segment so the same downstream account collapses to one
        project.
      </p>
    </div>
  );
}

// ─── Discrepancies ───────────────────────────────────────────────────────────

function DiscrepanciesPanel({ rec }: { rec: ReconciliationResult }) {
  const d = rec.discrepancies;
  const total =
    d.assignedNoHours.length +
    d.unassignedJobs.length +
    d.rateMismatches.length +
    d.unknownPersons.length;

  if (total === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        No discrepancies for this term. Actuals reconcile cleanly against
        staffing.
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <DiscCard title="Assigned, but no hours" count={d.assignedNoHours.length}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={TH}>Student</th>
              <th className={TH}>Project</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.assignedNoHours.map((x, i) => (
              <tr key={`${x.netId}-${i}`}>
                <td className={TD_PRIMARY}>{x.name}</td>
                <td className={TD}>{x.projectName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiscCard>

      <DiscCard
        title="DALI job with no matching assignment"
        count={d.unassignedJobs.length}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={TH}>Student</th>
              <th className={TH}>NetID</th>
              <th className={TH}>Job</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH}>Inferred project</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.unassignedJobs.map((x, i) => (
              <tr key={`${x.netId}-${i}`}>
                <td className={TD_PRIMARY}>{x.name}</td>
                <td className={cn(TD, "font-mono")}>{x.netId}</td>
                <td className={cn(TD, "font-mono")}>{x.jobId}</td>
                <td className={TD_NUM}>{x.hours.toLocaleString()}</td>
                <td className={TD}>{x.inferredProjectName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiscCard>

      <DiscCard title="Rate mismatch" count={d.rateMismatches.length}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={TH}>Student</th>
              <th className={TH}>Job</th>
              <th className={TH_NUM}>Σ earnings</th>
              <th className={TH_NUM}>expected</th>
              <th className={TH_NUM}>Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.rateMismatches.map((x, i) => (
              <tr key={`${x.netId}-${i}`}>
                <td className={TD_PRIMARY}>{x.name}</td>
                <td className={cn(TD, "font-mono")}>{x.jobId}</td>
                <td className={TD_NUM}>{formatUsd(x.actualPay)}</td>
                <td className={TD_NUM}>{formatUsd(x.expectedPay)}</td>
                <td
                  className={cn(
                    TD_NUM,
                    x.difference < 0 ? "text-red-600 font-semibold" : "text-foreground",
                  )}
                >
                  {x.difference < 0 ? "−" : "+"}
                  {formatUsd(Math.abs(x.difference))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-start gap-2 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Shown only for the currently-active term — there is no wage history, so
          comparing past terms against today's lookup rates would spray false
          mismatches.
        </div>
      </DiscCard>

      <DiscCard title="Unknown person" count={d.unknownPersons.length}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={TH}>NetID</th>
              <th className={TH}>Name on timesheet</th>
              <th className={TH_NUM}>Hours</th>
              <th className={TH_NUM}>Earnings</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.unknownPersons.map((x, i) => (
              <tr key={`${x.netId}-${i}`}>
                <td className={cn(TD_PRIMARY, "font-mono")}>{x.netId}</td>
                <td className={TD}>{x.name}</td>
                <td className={TD_NUM}>{x.hours.toLocaleString()}</td>
                <td className={TD_NUM}>{formatUsd(x.pay)}</td>
                <td className={TD}>
                  <span className="px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-600">
                    not in DALI OS — still counted
                  </span>
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
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Card className="overflow-hidden border-l-[3px] border-l-amber-500">
      <div className="flex items-center gap-2 px-4 py-3">
        <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
          {count}
        </span>
      </div>
      <div className="overflow-x-auto border-t border-border">{children}</div>
    </Card>
  );
}

// ─── External ────────────────────────────────────────────────────────────────

function ExternalPanel({ rec }: { rec: ReconciliationResult }) {
  const [open, setOpen] = useState(false);
  const ext = rec.external;
  const people = new Set(ext.jobs.map((j) => j.netId)).size;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <ChevronRight
            className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span className="flex-1 text-sm font-semibold text-foreground">
            External / not DALI — {people} people · {ext.totalHours.toLocaleString()} hrs ·{" "}
            {formatUsd(ext.totalPay)}{" "}
            <span className="font-normal text-muted-foreground">
              (excluded from DALI totals)
            </span>
          </span>
        </button>
        {open && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={TH}>NetID</th>
                  <th className={TH}>Name</th>
                  <th className={TH}>Job</th>
                  <th className={TH_NUM}>Hours</th>
                  <th className={TH_NUM}>Earnings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ext.jobs.map((j, i) => (
                  <tr key={`${j.netId}-${j.jobId}-${i}`}>
                    <td className={cn(TD, "font-mono")}>{j.netId}</td>
                    <td className={TD_PRIMARY}>{j.name}</td>
                    <td className={TD}>
                      <span className="font-mono">{j.jobId}</span> {j.jobTitle}
                    </td>
                    <td className={TD_NUM}>{j.hours.toLocaleString()}</td>
                    <td className={TD_NUM}>{formatUsd(j.pay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        Job IDs that match no JobCodeLookup row land here — a bucket, never a
        discrepancy. Their earnings are shown but excluded from every DALI total.
      </p>
    </div>
  );
}
