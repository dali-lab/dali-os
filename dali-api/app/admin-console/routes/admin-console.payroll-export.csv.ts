import type { Route } from "./+types/admin-console.payroll-export.csv";
import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import {
  buildPayrollRows,
  formatDate,
  pickDefaultTermId,
  rowsToCsv,
} from "~/admin-console/lib/payroll-export";

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

  const rows = await buildPayrollRows(selectedTerm.id);
  const csv = rowsToCsv(rows);
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
