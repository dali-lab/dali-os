import type { Route } from "./+types/expenses.export";
import { csvResponse } from "~/lib/csv";
import { exportExpensesCsv, exportExpensesPdf } from "../lib/export.server";
import { failure, guardExpenses } from "./guard.server";
import { parseExpenseFilters, parseScope } from "../lib/filters";

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await guardExpenses(request, { write: false, page: false });
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const format = params.get("format");
  if (format !== "csv" && format !== "pdf") {
    return Response.json({ ok: false, error: "Choose CSV or PDF." }, { status: 400 });
  }
  const scope = parseScope(params.get("scope"));
  const filters = parseExpenseFilters(params);
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    if (format === "csv") {
      return csvResponse(await exportExpensesCsv(guard.viewer, scope, filters), `expenses-${stamp}.csv`);
    }
    const pdf = await exportExpensesPdf(guard.viewer, scope, filters);
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="expenses-${stamp}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
