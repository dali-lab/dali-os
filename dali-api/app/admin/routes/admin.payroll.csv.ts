import type { Route } from "./+types/admin.payroll.csv";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin } from "~/lib/roles";
import { rowsToCsv, csvResponse } from "~/lib/csv";
import { resolveTermFilter } from "~/lib/terms";
import { getReconciliation } from "~/admin/lib/payroll-reconcile.server";
import type { CollatedResult } from "~/admin/lib/payroll-collation";
import { getBudgetData } from "~/admin/lib/budget";

// Resource route (GET) — one CSV per reconcile view. Registered OUTSIDE the app
// layout so the Response streams a bare CSV body. Uses the shared
// ~/lib/csv rowsToCsv/csvResponse (NOT payroll-export's own rowsToCsv, which
// takes PayrollRow objects). Same auth gate as the page.

const VIEWS = [
  "summary",
  "payroll-data",
  "projects",
  "chart-strings",
  "discrepancies",
  "external",
  "budget",
] as const;
type View = (typeof VIEWS)[number];

function isView(v: string | null): v is View {
  return v !== null && (VIEWS as readonly string[]).includes(v);
}

// Each view maps the collation result to a header row + body rows.
function buildRows(view: View, r: CollatedResult): unknown[][] {
  switch (view) {
    case "summary":
      return [
        ["Metric", "Value"],
        ["DALI hours", r.summary.daliHours],
        ["DALI pay", r.summary.daliPay],
        ["DALI students", r.summary.daliStudentCount],
        ["Median pay", r.summary.medianPay],
        ["External hours (excluded)", r.summary.externalHours],
        ["External pay (excluded)", r.summary.externalPay],
        ["Total hours", r.summary.totalHours],
        ["Total pay", r.summary.totalPay],
      ];

    case "payroll-data": {
      const rows: unknown[][] = [
        ["NetID", "Name", "Job ID", "Job Title", "Category", "Project(s)", "Hours", "Earnings"],
      ];
      const push = (
        j: {
          netId: string;
          name: string;
          jobId: string;
          jobTitle: string;
          category: string;
          hours: number;
          pay: number;
          sharedWith?: string[];
        },
        projects: string,
      ) =>
        rows.push([
          j.netId,
          j.name,
          j.jobId,
          j.jobTitle,
          j.category,
          projects,
          j.hours,
          j.pay,
        ]);
      for (const p of r.projects) {
        for (const j of p.jobs) {
          const proj = [p.projectName, ...(j.sharedWith ?? [])].join("; ");
          push(j, proj);
        }
      }
      for (const j of r.core.jobs) push(j, "Core");
      for (const j of r.instructor.jobs) push(j, "Instructor");
      return rows;
    }

    case "projects": {
      const rows: unknown[][] = [
        ["Project", "Students", "Hours", "Shared Hours", "Earnings"],
      ];
      for (const p of r.projects) {
        const students = new Set(p.jobs.map((j) => j.netId)).size;
        rows.push([p.projectName, students, p.totalHours, p.sharedHours, p.totalPay]);
      }
      return rows;
    }

    case "chart-strings": {
      const rows: unknown[][] = [
        ["Chart String", "Project(s)", "Ambiguous", "Hours", "Earnings"],
      ];
      for (const cs of r.chartStrings) {
        rows.push([
          cs.chartString,
          cs.projects.map((p) => p.name).join("; "),
          cs.ambiguousProject ? "yes" : "",
          cs.totalHours,
          cs.totalPay,
        ]);
      }
      return rows;
    }

    case "discrepancies": {
      const rows: unknown[][] = [
        ["Type", "NetID", "Name", "Job ID", "Detail", "Hours", "Earnings"],
      ];
      for (const d of r.discrepancies.assignedNoHours)
        rows.push(["Assigned, no hours", d.netId, d.name, "", d.projectName, "", ""]);
      for (const d of r.discrepancies.unassignedJobs)
        rows.push([
          "DALI job, no assignment",
          d.netId,
          d.name,
          d.jobId,
          d.inferredProjectName ?? "",
          d.hours,
          d.pay,
        ]);
      for (const d of r.discrepancies.rateMismatches)
        rows.push([
          "Rate mismatch",
          d.netId,
          d.name,
          d.jobId,
          `expected ${d.expectedPay.toFixed(2)} @ ${d.lookupRate}`,
          d.hours,
          d.actualPay,
        ]);
      for (const d of r.discrepancies.unknownPersons)
        rows.push(["Unknown person", d.netId, d.name, "", "not in DALI OS", d.hours, d.pay]);
      return rows;
    }

    case "external": {
      const rows: unknown[][] = [
        ["NetID", "Name", "Job ID", "Job Title", "Hours", "Earnings"],
      ];
      for (const j of r.external.jobs)
        rows.push([j.netId, j.name, j.jobId, j.jobTitle, j.hours, j.pay]);
      return rows;
    }

    case "budget":
      // Budget has its own data source (getBudgetData); handled in the loader,
      // not from the CollatedResult. Unreachable here.
      return [];
  }
}

function buildBudgetRows(
  budget: Awaited<ReturnType<typeof getBudgetData>>,
): unknown[][] {
  const rows: unknown[][] = [
    ["Project", "Chart String", "Type", "Revenue", "Adj. Revenue", "Expense", "Net"],
  ];
  for (const g of budget.groups) {
    for (const row of g.rows) {
      rows.push([
        g.projectName,
        row.chartString,
        row.projectType ?? "",
        row.revenue,
        row.adjustedRevenue,
        row.expense,
        row.net,
      ]);
    }
  }
  rows.push([
    "Grand total",
    "",
    "",
    budget.grandTotalRevenue,
    budget.grandTotalAdjustedRevenue,
    budget.grandTotalExpense,
    budget.grandTotalNet,
  ]);
  return rows;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) return forbidden(request);

  const url = new URL(request.url);
  const viewParam = url.searchParams.get("view");
  if (!isView(viewParam)) {
    return new Response("Unknown view", { status: 400 });
  }

  const { termId, terms, selected } = await resolveTermFilter(request);
  if (!termId) {
    return new Response("No term selected", { status: 404 });
  }

  const rows =
    viewParam === "budget"
      ? buildBudgetRows(await getBudgetData(termId))
      : buildRows(viewParam, await getReconciliation(termId));
  const csv = rowsToCsv(rows);

  const termCode = terms.find((t) => t.id === selected)?.code ?? "term";
  const fileStamp = new Date().toISOString().slice(0, 10);
  const filename = `payroll-${viewParam}-${termCode}-${fileStamp}.csv`;

  return csvResponse(csv, filename, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
