import type { Route } from "./+types/admin-console.payroll-export.csv";
import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import {
  buildCoreRows,
  buildInstructorRows,
  buildPayrollRows,
  formatDate,
  pickDefaultTermId,
  rowsToCsv,
} from "~/admin-console/lib/payroll-export";

// Comma-separated user-id list → Set. Empty/null → empty set (= no rows).
function parseIdList(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

// Resource route — no default export, no layout wrapping. Returning a Response
// from a route that's nested under the app layout would have the layout shell
// rendered around it (i.e. an HTML page wrapping a CSV body). Splitting the
// download into its own resource route under a non-layout path keeps it as a
// pure byte stream.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) {
    return new Response("Forbidden", { status: 403 });
  }

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
    return new Response("No terms available", { status: 404 });
  }

  // Project rows always included; Core + Instructor rows only for the
  // user-ids the admin checked on the page (passed via ?core= / ?instructor=).
  const coreIds = parseIdList(url.searchParams.get("core"));
  const instructorIds = parseIdList(url.searchParams.get("instructor"));

  const [projectRows, coreRows, instructorRows] = await Promise.all([
    buildPayrollRows(selectedTerm.id),
    buildCoreRows(selectedTerm.id, coreIds),
    buildInstructorRows(selectedTerm.id, instructorIds),
  ]);
  const csv = rowsToCsv([...projectRows, ...coreRows, ...instructorRows]);
  const filename = `payroll-${selectedTerm.code}-${formatDate(new Date())}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
