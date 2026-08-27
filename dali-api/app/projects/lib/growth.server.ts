import { prisma } from "~/lib/db";
import { getSlotBinding } from "./form-slots";

// The two "Growth" request flows. Both are staffing slots (per-cycle bindable
// forms) that feed the Growth review board; they differ only in intent:
// level-up bumps an existing DomainEligibility, domain-join creates a first P1
// in a domain the member isn't in yet. Kept here so the Growth board, the
// per-flow settings, and the domain-hub CTAs share one source of truth.
export const GROWTH_SLOTS = ["level-up", "domain-join"] as const;
export type GrowthSlot = (typeof GROWTH_SLOTS)[number];

export function isGrowthSlot(v: string): v is GrowthSlot {
  return (GROWTH_SLOTS as readonly string[]).includes(v);
}

// Carry a Growth flow's binding forward to a cycle that has none yet.
//
// This is the "stop duplicating the form each term" fix: Core binds a form
// (maps its columns, sets open/closed) ONCE, and every future term inherits the
// SAME form + mapping automatically. Submissions then file under the current
// term's cycle and the board's per-term filter isolates results — no new form,
// no re-binding, no old results bleeding into the current term.
//
// create-if-absent: never clobbers a binding Core set for THIS cycle. Copies
// from the most-recently-updated binding for the same slot across all cycles.
// No prior binding anywhere = nothing to copy (the flow reads "not set up" until
// Core binds a form for the first time). Idempotent; safe to call on every load.
export async function ensureGrowthBindings(
  staffingCycleId: string,
): Promise<void> {
  for (const slot of GROWTH_SLOTS) {
    const existing = await prisma.staffingCycleFormBinding.findUnique({
      where: { staffingCycleId_slot: { staffingCycleId, slot } },
      select: { id: true },
    });
    if (existing) continue;

    const prior = await prisma.staffingCycleFormBinding.findFirst({
      where: { slot, staffingCycleId: { not: staffingCycleId } },
      orderBy: { updatedAt: "desc" },
      select: {
        formId: true,
        columnMapping: true,
        enabled: true,
        updatedById: true,
      },
    });
    if (!prior) continue;

    // The prior form may have been deleted since; don't create a dangling bind.
    const form = await prisma.form.findUnique({
      where: { id: prior.formId },
      select: { id: true },
    });
    if (!form) continue;

    try {
      await prisma.staffingCycleFormBinding.create({
        data: {
          staffingCycleId,
          slot,
          formId: prior.formId,
          enabled: prior.enabled,
          updatedById: prior.updatedById,
          ...(prior.columnMapping != null
            ? { columnMapping: prior.columnMapping }
            : {}),
        },
      });
    } catch (e) {
      // Lost a create race (unique cycle+slot) — the binding now exists.
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
}

export type GrowthFlowState =
  | { open: true; reason: "ok"; formId: string; publicToken: string | null }
  | {
      open: false;
      reason: "not-configured" | "closed";
      formId: string | null;
      publicToken: string | null;
    };

// Whether a Growth flow can be requested right now, and where to send the
// member. `not-configured` = Core hasn't bound a form; `closed` = Core turned
// the flow off. The domain-hub CTA reads this to render/hide the button and the
// submit path re-checks it server-side (never trust the hidden CTA).
export async function growthFlowState(
  staffingCycleId: string,
  slot: GrowthSlot,
): Promise<GrowthFlowState> {
  const b = await getSlotBinding(staffingCycleId, slot);
  if (!b)
    return {
      open: false,
      reason: "not-configured",
      formId: null,
      publicToken: null,
    };
  if (!b.enabled)
    return {
      open: false,
      reason: "closed",
      formId: b.formId,
      publicToken: b.publicToken,
    };
  return { open: true, reason: "ok", formId: b.formId, publicToken: b.publicToken };
}
