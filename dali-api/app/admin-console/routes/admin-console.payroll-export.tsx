import { Form, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin-console.payroll-export";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { Download, FileDown, AlertTriangle } from "lucide-react";
import {
  buildPayrollRows,
  pickDefaultTermId,
  type PayrollRow,
} from "~/admin-console/lib/payroll-export";

export const meta: Route.MetaFunction = () => [
  { title: "Payroll export · Operations · DALI OS" },
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
    return { terms: [], selectedTermId: null, rows: [] as PayrollRow[] };
  }

  const rows = await buildPayrollRows(selectedTerm.id);

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
  const csvHref = `/admin-console/payroll-export.csv?termId=${encodeURIComponent(selectedTermId)}`;

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
              .filter(([k]) => k !== "termId")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
          </Form>
          <a
            href={csvHref}
            download
            // reloadDocument tells React Router not to intercept this link as a
            // client navigation. The browser does a real GET to the resource
            // route, which streams the CSV with Content-Disposition: attachment.
            data-discover="false"
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
