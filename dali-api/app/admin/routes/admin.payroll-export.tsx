import { useMemo, useState } from "react";
import { redirect, useLoaderData, useSearchParams, useSubmit } from "react-router";
import type { Route } from "./+types/admin.payroll-export";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin } from "~/lib/roles";
import { Download, FileDown, AlertTriangle, Users } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { buttonClasses } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { ALL_LEVELS, isLevel } from "~/lib/level";
import {
  buildPayrollRows,
  listCoreCandidates,
  listInstructorCandidates,
  listTermDomains,
  pickDefaultTermId,
  type PayrollRow,
  type RoleCandidate,
} from "~/admin/lib/payroll-export";

// Comma-separated search-param → trimmed, deduped values.
function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

export const handle = adminHandle("payroll");

export const meta: Route.MetaFunction = () => [
  { title: "Payroll Export · Admin · DALI OS" },
];

// The CSV itself is served by the sibling resource route at
// /admin/payroll-export.csv (no layout wrapping), so the Download
// button is a plain link to that URL.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin/members");

  const url = new URL(request.url);
  const requestedTermId = url.searchParams.get("term");
  const selectedDomainIds = parseCsvParam(url.searchParams.get("domain"));
  const selectedLevels = parseCsvParam(url.searchParams.get("level")).filter(isLevel);

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
      termDomains: [] as { id: string; displayName: string }[],
      selectedDomainIds,
      selectedLevels,
      isAdmin: true,
    };
  }

  const [projectRows, coreCandidates, instructorCandidates, termDomains] =
    await Promise.all([
      buildPayrollRows(selectedTerm.id, {
        domainIds: selectedDomainIds,
        levels: selectedLevels,
      }),
      listCoreCandidates(selectedTerm.id),
      listInstructorCandidates(selectedTerm.id),
      listTermDomains(selectedTerm.id),
    ]);

  // Flag the term bracketing now() so the picker can mark it "· current",
  // matching every other term filter. The default term stays pickDefaultTermId.
  const now = new Date();
  const currentTermId =
    terms.find((t) => t.startDate <= now && now <= t.endDate)?.id ?? null;

  return {
    terms: terms.map((t) => ({ id: t.id, code: t.code, isCurrent: t.id === currentTermId })),
    selectedTermId: selectedTerm.id,
    selectedTermCode: selectedTerm.code,
    projectRows,
    coreCandidates,
    instructorCandidates,
    termDomains,
    selectedDomainIds,
    selectedLevels,
    isAdmin: true,
  };
}

export default function PayrollExport() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();

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
          <h1 className="text-2xl font-bold text-foreground">Payroll Export</h1>
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
    termDomains,
    selectedDomainIds,
    selectedLevels,
  } = data;

  // A role filter narrows only the Project assignments section. Core and
  // Instructor are independent opt-in sections (their own checkboxes), so a
  // domain/level filter leaves them untouched — e.g. "PMs + Core" is the PM
  // filter with the Core people checked.
  const filterActive = selectedDomainIds.length > 0 || selectedLevels.length > 0;
  const filterSummary = [
    termDomains
      .filter((d) => selectedDomainIds.includes(d.id))
      .map((d) => d.displayName)
      .join(", "),
    selectedLevels.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  const projectWarnings = projectRows.filter((r) => r.warnings.length > 0).length;
  const totalRows =
    projectRows.length + coreSelected.size + instructorSelected.size;

  const csvHref = useMemo(() => {
    const params = new URLSearchParams({ term: selectedTermId });
    if (selectedDomainIds.length > 0)
      params.set("domain", selectedDomainIds.join(","));
    if (selectedLevels.length > 0) params.set("level", selectedLevels.join(","));
    if (coreSelected.size > 0) params.set("core", [...coreSelected].join(","));
    if (instructorSelected.size > 0)
      params.set("instructor", [...instructorSelected].join(","));
    return `/admin/payroll-export.csv?${params.toString()}`;
  }, [
    selectedTermId,
    selectedDomainIds,
    selectedLevels,
    coreSelected,
    instructorSelected,
  ]);

  // Toggle one value in a comma-separated filter param and re-navigate (GET),
  // preserving the other params — same mechanism the Term picker uses.
  function toggleFilterValue(key: "domain" | "level", value: string) {
    const params = new URLSearchParams(searchParams);
    const current = new Set(
      (params.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    if (current.has(value)) current.delete(value);
    else current.add(value);
    if (current.size > 0) params.set(key, [...current].join(","));
    else params.delete(key);
    submit(params, { method: "get" });
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams);
    params.delete("domain");
    params.delete("level");
    submit(params, { method: "get" });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FileDown className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">Payroll Export</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {totalRows} {totalRows === 1 ? "row" : "rows"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Term</label>
            <Select
              value={selectedTermId}
              ariaLabel="Term"
              options={terms.map((t) => ({
                value: t.id,
                label: t.isCurrent ? `${t.code} · current` : t.code,
              }))}
              // Submit the picked value explicitly (a GET nav that preserves any
              // other params) — don't re-submit the form's DOM, which would still
              // hold the old value in the same tick.
              onChange={(value) => {
                const params = new URLSearchParams(searchParams);
                params.set("term", value);
                // Domain pills are drawn from the selected term's assignments,
                // so a term switch resets the role filter to avoid stale ids.
                params.delete("domain");
                params.delete("level");
                submit(params, { method: "get" });
              }}
              buttonClassName="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </div>
          <a
            href={csvHref}
            download
            data-discover="false"
            className={buttonClasses("primary", "sm")}
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

      {/* ─── Role filter ──────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-sm font-medium text-foreground">Filter</span>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Domain
            </span>
            {termDomains.length === 0 ? (
              <span className="text-xs text-muted-foreground/70">
                none this term
              </span>
            ) : (
              termDomains.map((d) => (
                <FilterPill
                  key={d.id}
                  label={d.displayName}
                  active={selectedDomainIds.includes(d.id)}
                  onClick={() => toggleFilterValue("domain", d.id)}
                />
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Level
            </span>
            {ALL_LEVELS.map((l) => (
              <FilterPill
                key={l}
                label={l}
                active={selectedLevels.includes(l)}
                onClick={() => toggleFilterValue("level", l)}
              />
            ))}
          </div>

          {filterActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs font-medium text-accent-coral hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>
        {filterActive && (
          <p className="text-xs text-muted-foreground">
            Project assignments narrowed to{" "}
            <strong className="text-foreground">{filterSummary}</strong>. Core
            and Instructor selections below are unaffected — check them to
            include those people too (e.g. PMs + Core).
          </p>
        )}
      </section>

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
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Domain</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Level</th>
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
                  <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground/70">
                    {filterActive
                      ? "No project assignments match this filter."
                      : "No project assignments for this term."}
                  </td>
                </tr>
              )}
              {projectRows.map((r, i) => (
                <tr key={i} className="hover:bg-muted/50">
                  <td className="px-3 py-2 text-foreground font-mono">{r.netId || "—"}</td>
                  <td className="px-3 py-2 text-foreground">
                    {r.firstName} {r.lastName}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.domain || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.level || "—"}</td>
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
                    <Checkbox
                      checked={checked}
                      onChange={() => toggle(c.userId)}
                      aria-label={`Include ${c.firstName} ${c.lastName} in payroll export`}
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

// Multi-select toggle pill for the domain / level role filter. Active pills use
// the coral accent; toggling navigates (GET) to update the filter search param.
function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? "bg-accent-coral/15 border-accent-coral/40 text-accent-coral"
          : "bg-background border-border text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {label}
    </button>
  );
}
