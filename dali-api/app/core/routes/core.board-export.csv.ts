import type { Route } from "./+types/core.board-export.csv";
import { redirect } from "react-router";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewStaffing } from "~/lib/roles";
import { csvResponse, rowsToCsv } from "~/lib/csv";
import { getSlotBinding, isSlot } from "~/projects/lib/form-slots";
import { resolveBoardCycles } from "~/projects/lib/slot-board.server";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { filterBoardRows } from "~/projects/lib/board-filters";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const params = new URL(request.url).searchParams;
  const slot = params.get("slot") ?? "";
  if (!isSlot(slot)) return new Response("Unknown board", { status: 400 });

  const cycles = await resolveBoardCycles(request, { create: false });
  const binding = cycles?.singleCycleId ? await getSlotBinding(cycles.singleCycleId, slot) : null;
  const view = cycles
    ? await buildSubmissionView({ cycleIds: cycles.cycleIds, slot, formId: binding?.formId ?? null })
    : { tableColumns: [], rows: [] };
  const columns = view.tableColumns;
  const rows = filterBoardRows(view.rows, columns.map((c) => c.key), params);

  const csv = rowsToCsv([
    ["Member", "Email", ...columns.map((c) => c.label)],
    ...rows.map((r) => [r.name, r.email ?? "", ...columns.map((c) => r.cells[c.key] ?? "")]),
  ]);
  const term = cycles?.isAll ? "all-terms" : (cycles?.cycleName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return csvResponse(csv, `${slot}-${term || "board"}-${new Date().toISOString().slice(0, 10)}.csv`, {
    headers: { "Cache-Control": "no-store" },
  });
}
