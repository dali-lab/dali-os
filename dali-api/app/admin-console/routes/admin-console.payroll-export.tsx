import { useMemo, useState } from "react";
import { Form, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin-console.payroll-export";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { Download, FileDown, AlertTriangle, Users } from "lucide-react";
import {
  buildPayrollRows,
  listCoreCandidates,
  listInstructorCandidates,
  pickDefaultTermId,
  type PayrollRow,
  type RoleCandidate,
} from "~/admin-console/lib/payroll-export";

export const meta: Route.MetaFunction = () => [
  { title: "Payroll export · Admin · DALI OS" },
];

// The CSV itself is served by the sibling resource route at
// /admin-console/payroll-export.csv (no layout wrapping), so the Download
// button is a plain link to that URL.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console/members");

  const url = new URL(request.url);
  const requestedTermId = url.searchParams.get("termId");

  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: { id: true, code: true, startDate: true, endDate: true },
  });

  const selectedTermId =
    (requestedTermId && terms.some((t) => t.id === requestedTermId)
      ? requestedTermId
      : pickDefaultTermId(terms));
  const selectedTerm = terms.find((t) => t.id === selectedTermId);

  if (!selectedTerm) {
    return {
      terms: [],
      selectedTermId: null,
      projectRows: [] as PayrollRow[],
      coreCandidates: [] as RoleCandidate[],
      instructorCandidates: [] as RoleCandidate[],
    };
  }

  const [projectRows, coreCandidates, instructorCandidates] = await Promise.all([
    buildPayrollRows(selectedTerm.id),
    listCoreCandidates(selectedTerm.id),
    listInstructorCandidates(selectedTerm.id),
  ]);

  return {
    terms: terms.map((t) => ({ id: t.id, code: t.code })),
    selectedTermId: selectedTerm.id,
    selectedTermCode: selectedTerm.code,
    projectRows,
    coreCandidates,
    instructorCandidates,
  };
}

export default function PayrollExport() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  // Selection state for the Core / Instructor checkbox sections. Default to
  // every candidate checked — admins uncheck people who didn't work that
  // term (Summer is the main case). State is not persisted across reloads.
  const [coreSelected, setCoreSelected] = useState<Set<string>>(
    () => new Set(("coreCandidates" in data ? data.coreCandidates : []).map((c) => c.userId)),
  );
  const [instructorSelected, setInstructorSelected] = useState<Set<string>>(
    () => new Set(("instructorCandidates" in data ? data.instructorCandidates : []).map((c) => c.userId)),
  );

  if (!("projectRows" in data) || !data.selectedTermId) {
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

  const {
    terms,
    selectedTermId,
    selectedTermCode,
    projectRows,
    coreCandidates,
    instructorCandidates,
  } = data;

  const projectWarnings = projectRows.filter((r) => r.warnings.length > 0).length;
  const totalRows =
    projectRows.length + coreSelected.size + instructorSelected.size;

  const csvHref = useMemo(() => {
    const params = new URLSearchParams({ termId: selectedTermId });
    if (coreSelected.size > 0) params.set("core", [...coreSelected].join(","));
    if (instructorSelected.size > 0)
      params.set("instructor", [...instructorSelected].join(","));
    return `/admin-console/payroll-export.csv?${params.toString()}`;
  }, [selectedTermId, coreSelected, instructorSelected]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FileDown className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">Payroll export</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {totalRows} {totalRows === 1 ? "row" : "rows"}
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
              .filter(([k]) => k !== "termId")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
          </Form>
          <a
            href={csvHref}
            download
            data-discover="false"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            <Download className="w-4 h-4" /> Download CSV
          </a>
        </div>
      </header>

      <p className="text-sm text-muted-foreground">
        Project assignments are auto-included. Core and Instructor sections are
        opt-in per member — uncheck anyone who isn't working in{" "}
        <strong>{selectedTermCode}</strong>. Primary supervisor, secondary
        supervisor, and anticipated hours/week are constants; phone, term, and
        max-hours columns are intentionally blank per the payroll spec.
      </p>

      {/* ─── Project section ──────────────────────────────────────────────── */}
      <section className="space-y-2">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">
              Project assignments
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {projectRows.length}
            </span>
          </div>
          {projectWarnings > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              {projectWarnings} row{projectWarnings === 1 ? "" : "s"} with missing data
            </span>
          )}
        </header>
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
              {projectRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground/70">
                    No project assignments for this term.
                  </td>
                </tr>
              )}
              {projectRows.map((r, i) => (
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
      </section>

      <CandidateSection
        title="Core"
        candidates={coreCandidates}
        selected={coreSelected}
        setSelected={setCoreSelected}
        emptyLabel="No Core assignments for this term."
      />

      <CandidateSection
        title="Instructors"
        candidates={instructorCandidates}
        selected={instructorSelected}
        setSelected={setInstructorSelected}
        emptyLabel="No Instructor assignments for this term."
      />
    </div>
  );
}

// Checkbox section for Core / Instructor candidates. Shows a small roster, a
// Select all / Clear toggle, and per-row checkboxes. Selection state lives in
// the parent and drives the CSV download URL.
function CandidateSection({
  title,
  candidates,
  selected,
  setSelected,
  emptyLabel,
}: {
  title: string;
  candidates: RoleCandidate[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  emptyLabel: string;
}) {
  const allChecked = candidates.length > 0 && selected.size === candidates.length;

  function toggle(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelected(next);
  }

  function toggleAll() {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(candidates.map((c) => c.userId)));
  }

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-foreground/70" />
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {selected.size} of {candidates.length}
          </span>
        </div>
        {candidates.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            {allChecked ? "Clear all" : "Select all"}
          </button>
        )}
      </header>
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="w-10 px-3 py-2"></th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">NetID</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                {title === "Core" ? "Title(s)" : "Offering(s)"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {candidates.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground/70">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {candidates.map((c) => {
              const checked = selected.has(c.userId);
              return (
                <tr
                  key={c.userId}
                  className={`hover:bg-muted/50 ${checked ? "" : "opacity-50"}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.userId)}
                      aria-label={`Include ${c.firstName} ${c.lastName} in payroll export`}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 text-foreground font-mono">{c.netId || "—"}</td>
                  <td className="px-3 py-2 text-foreground">
                    {c.firstName} {c.lastName}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.subtitle || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
