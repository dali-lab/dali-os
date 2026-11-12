import { prisma } from "~/lib/db.server";
import { resolveTermFilter } from "~/lib/terms";
import { ensureStaffingCycle } from "./staffing-cycle";
import { setSlotBuiltinColumn, type Slot } from "./form-slots";
import { isBoardColumnBuiltin } from "./slot-roles";
import { currentTerm, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

// Which staffing cycles a slot board reads for the viewed ?term=: every cycle
// for "All terms", else the selected term's cycle (the current term by
// default). The board itself creates a missing cycle; read-only callers
// (export) pass create: false and get no cycle instead.
export async function resolveBoardCycles(
  request: Request,
  { create }: { create: boolean },
) {
  const {
    terms: termOptions,
    selected: selectedTerm,
    termId: filterTermId,
    isAll,
  } = await resolveTermFilter(request);
  const fallbackTerm = await currentTerm();
  if (!fallbackTerm && termOptions.length === 0) return null;

  const base = { termOptions, selectedTerm, isAll };
  if (isAll) {
    const cycles = await prisma.staffingCycle.findMany({ select: { id: true } });
    return {
      ...base,
      cycleIds: cycles.map((c) => c.id),
      cycleName: "all terms",
      singleCycleId: null,
    };
  }
  const t =
    termOptions.find((o) => o.id === filterTermId) ??
    (fallbackTerm ? { id: fallbackTerm.id, code: fallbackTerm.code } : termOptions[0]);
  const cycle = create
    ? await ensureStaffingCycle(t.id, t.code)
    : await prisma.staffingCycle.findUnique({
        where: { termId: t.id },
        select: { id: true, name: true },
      });
  return {
    ...base,
    cycleIds: cycle ? [cycle.id] : [],
    cycleName: cycle?.name ?? t.code,
    singleCycleId: cycle?.id ?? null,
  };
}

// The "set-slot-column" board intent: the header's + button and column menu.
// The caller has already checked the user manages staffing.
export async function setBoardColumn(
  form: FormData,
  cycleId: string,
  slot: Slot,
  userId: string,
  request: Request,
): Promise<Response> {
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("form-response-views", userId, roles, request)))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const builtin = form.get("builtin");
  if (!isBoardColumnBuiltin(builtin))
    return Response.json({ error: "Unknown column" }, { status: 400 });
  const result = await setSlotBuiltinColumn(
    cycleId,
    slot,
    builtin,
    form.get("shown") === "1",
    userId,
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
