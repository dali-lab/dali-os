import { Form, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin-console.payroll-export";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { Download, FileDown, AlertTriangle } from "lucide-react";

export const meta: Route.MetaFunction = () => [
  { title: "Payroll export · Operations · DALI OS" },
];

// ─── Constants per payroll spec ──────────────────────────────────────────────
// Single hardcoded primary/secondary supervisor for the whole lab. Per spec,
// every row gets these NetIDs. If supervisors ever differ per project, replace
// with a per-project field on Project (mirroring chartString).
const PRIMARY_SUPERVISOR_NETID = "f0077bn";
const SECONDARY_SUPERVISOR_NETID = "d1207c2";
const ANTICIPATED_HOURS_PER_WEEK = "15";

// 16-column header, order matters — Dartmouth payroll imports column-by-column.
const CSV_HEADERS = [
  "Student NetID",
  "Student First Name",
  "Student Last Name",
  "Job ID",
  "Primary Supervisor NetID",
  "Secondary Supervisor NetID",
  "Hourly Wage",
  "Anticipated Hours per week",
  "Hire Start Date",
  "Hire End Date",
  "Chart String Type",
  "Full Chart String",
  "Student Phone Number",
  "Term",
  "Max Hours – PTO",
  "Max Hours – Mental Health",
] as const;

type PayrollRow = {
  netId: string;
  firstName: string;
  lastName: string;
  jobId: string;
  hourlyWage: string;
  hireStart: string;
  hireEnd: string;
  chartStringType: string;
  chartString: string;
  // Tracked for the preview UI so admins can spot misconfigured projects /
  // missing job-code lookups before downloading. Omitted from CSV cells, where
  // a missing value is just an empty string.
  warnings: string[];
};

// RFC 4180 quoting: wrap in quotes if value contains a comma, quote, or newline;
// double up internal quotes.
function csvCell(raw: string): string {
  if (raw === "") return "";
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function formatDate(d: Date): string {
  // ISO YYYY-MM-DD; Dartmouth payroll accepts this format.
  return d.toISOString().slice(0, 10);
}

// JobCodeLookup uses nullable `level` and `domainId` as wildcards. Match the
// most specific row first: exact (level, domain) > level-only > domain-only >
// wildcard. Returns null if nothing matches (admin should seed JobCodeLookup
// before relying on the export).
function resolveJobCode(
  lookups: Array<{
    level: string | null;
    domainId: string | null;
    jobCode: string;
    payRateUsdHour: { toString(): string } | null;
  }>,
  level: string,
  domainId: string,
): { jobCode: string; hourlyWage: string } | null {
  const candidates = lookups
    .filter((l) => (l.level === null || l.level === level))
    .filter((l) => (l.domainId === null || l.domainId === domainId));
  if (candidates.length === 0) return null;
  // Most specific first.
  candidates.sort((a, b) => {
    const specA = (a.level !== null ? 2 : 0) + (a.domainId !== null ? 1 : 0);
    const specB = (b.level !== null ? 2 : 0) + (b.domainId !== null ? 1 : 0);
    return specB - specA;
  });
  const best = candidates[0];
  return {
    jobCode: best.jobCode,
    hourlyWage: best.payRateUsdHour ? best.payRateUsdHour.toString() : "",
  };
}

async function buildRows(termId: string): Promise<PayrollRow[]> {
  const [assignments, jobLookups, term] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { termId },
      include: {
        user: { select: { netId: true, firstName: true, lastName: true } },
        project: {
          select: { name: true, chartStringType: true, chartString: true },
        },
      },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    }),
    prisma.jobCodeLookup.findMany({
      where: { assignmentType: "Project" },
      select: { level: true, domainId: true, jobCode: true, payRateUsdHour: true },
    }),
    prisma.term.findUnique({
      where: { id: termId },
      select: { startDate: true, endDate: true },
    }),
  ]);

  if (!term) return [];

  const hireStart = formatDate(term.startDate);
  const hireEnd = formatDate(term.endDate);

  return assignments.map((a) => {
    const warnings: string[] = [];
    const job = resolveJobCode(jobLookups, a.level, a.domainId);
    if (!job) warnings.push(`No JobCodeLookup for level=${a.level}`);
    if (!a.project.chartString) warnings.push("Project missing chartString");
    if (!a.user.netId) warnings.push("User missing NetID");

    return {
      netId: a.user.netId ?? "",
      firstName: a.user.firstName,
      lastName: a.user.lastName,
      jobId: job?.jobCode ?? "",
      hourlyWage: job?.hourlyWage ?? "",
      hireStart,
      hireEnd,
      chartStringType: a.project.chartStringType ?? "",
      chartString: a.project.chartString ?? "",
      warnings,
    };
  });
}

function toCsv(rows: PayrollRow[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.map(csvCell).join(","));
  for (const r of rows) {
    lines.push(
      [
        r.netId,
        r.firstName,
        r.lastName,
        r.jobId,
        PRIMARY_SUPERVISOR_NETID,
        SECONDARY_SUPERVISOR_NETID,
        r.hourlyWage,
        ANTICIPATED_HOURS_PER_WEEK,
        r.hireStart,
        r.hireEnd,
        r.chartStringType,
        r.chartString,
        "", // Student Phone Number — blank per spec
        "", // Term — blank per spec
        "", // Max Hours – PTO — blank per spec
        "", // Max Hours – Mental Health — blank per spec
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // RFC 4180 uses CRLF; payroll importers handle either, CRLF is safer for
  // Excel on Windows.
  return lines.join("\r\n") + "\r\n";
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const requestedTermId = url.searchParams.get("termId");

  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: { id: true, code: true, startDate: true, endDate: true },
  });

  // Default to the term whose [startDate, endDate] contains today; falls back
  // to the most recent term if no current term.
  const now = new Date();
  const defaultTerm =
    terms.find((t) => t.startDate <= now && now <= t.endDate) ?? terms[0];
  const selectedTerm =
    terms.find((t) => t.id === requestedTermId) ?? defaultTerm;

  if (!selectedTerm) {
    return { terms: [], selectedTermId: null, rows: [] as PayrollRow[] };
  }

  const rows = await buildRows(selectedTerm.id);

  if (format === "csv") {
    const csv = toCsv(rows);
    const filename = `payroll-${selectedTerm.code}-${formatDate(now)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return {
    terms: terms.map((t) => ({ id: t.id, code: t.code })),
    selectedTermId: selectedTerm.id,
    selectedTermCode: selectedTerm.code,
    rows,
  };
}

export default function PayrollExport() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  if (!("rows" in data) || !data.selectedTermId) {
    return (
      <div className="space-y-4">
        <header className="flex items-center gap-3">
          <FileDown className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">Payroll export</h1>
        </header>
        <p className="text-sm text-muted-foreground">
          No terms found. Seed Terms before generating a payroll export.
        </p>
      </div>
    );
  }

  const { terms, selectedTermId, selectedTermCode, rows } = data;
  const rowsWithWarnings = rows.filter((r) => r.warnings.length > 0).length;
  const csvHref = `?termId=${encodeURIComponent(selectedTermId)}&format=csv`;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FileDown className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">Payroll export</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Form method="get" className="flex items-center gap-2">
            <label htmlFor="termId" className="text-sm text-muted-foreground">
              Term
            </label>
            <select
              id="termId"
              name="termId"
              defaultValue={selectedTermId}
              onChange={(e) => e.currentTarget.form?.submit()}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                </option>
              ))}
            </select>
            {/* Preserve any other params on submit (none today, future-proof). */}
            {Array.from(searchParams.entries())
              .filter(([k]) => k !== "termId" && k !== "format")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
          </Form>
          <a
            href={csvHref}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            <Download className="w-4 h-4" /> Download CSV
          </a>
        </div>
      </header>

      <p className="text-sm text-muted-foreground">
        One row per project assignment in <strong>{selectedTermCode}</strong>.
        Primary supervisor, secondary supervisor, and anticipated hours per
        week are constants; phone, term, and max-hours columns are intentionally
        blank per the payroll spec.
      </p>

      {rowsWithWarnings > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            {rowsWithWarnings} {rowsWithWarnings === 1 ? "row has" : "rows have"}{" "}
            missing data (see the warnings column). The CSV will still download —
            those cells will be empty.
          </span>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">NetID</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Job ID</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Wage</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Hire Start</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Hire End</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Chart Type</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Chart String</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Warnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground/70">
                  No project assignments for this term.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-muted/50">
                <td className="px-3 py-2 text-foreground font-mono">{r.netId || "—"}</td>
                <td className="px-3 py-2 text-foreground">
                  {r.firstName} {r.lastName}
                </td>
                <td className="px-3 py-2 text-foreground font-mono">{r.jobId || "—"}</td>
                <td className="px-3 py-2 text-foreground">{r.hourlyWage || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.hireStart}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.hireEnd}</td>
                <td className="px-3 py-2 text-foreground">{r.chartStringType || "—"}</td>
                <td className="px-3 py-2 text-foreground font-mono break-all">{r.chartString || "—"}</td>
                <td className="px-3 py-2 text-amber-700">
                  {r.warnings.length > 0 ? r.warnings.join("; ") : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
