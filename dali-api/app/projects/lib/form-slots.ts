import { prisma } from "~/lib/db";
import type { SigningAudience } from "~/generated/prisma/enums";
import { parseColumnMapping, type ColumnMapping } from "./slot-roles";

// Audiences an operator can lock a bound form to (a subset of the signing
// SigningAudience enum, whose resolvers the gate reuses). Manual/HiringParticipants
// are excluded — Manual means "off" (represented as a null gateAudience) and
// hiring participation is gated inside hiring, not the staffing app-lock.
export const GATE_AUDIENCES = [
  "NewMembers",
  "Members",
  "Mentors",
  "Group",
] as const satisfies readonly SigningAudience[];

export type GateAudience = (typeof GATE_AUDIENCES)[number];

export function isGateAudience(value: string): value is GateAudience {
  return (GATE_AUDIENCES as readonly string[]).includes(value);
}

// A "form slot" is a named place in the app that expects an admin-chosen
// generic Form, scoped to one staffing cycle (i.e. per term). Intent to Work
// and Project Bids are the first two slots; the binding table keys on a free
// string so adding a slot later needs no migration. No binding for a slot =
// nothing selected yet (callers fall back to their default behavior).
export const SLOTS = {
  "intent-to-work": "Intent to Work",
  "project-bids": "Project Bids",
  "level-up": "Level Up",
} as const;

export type Slot = keyof typeof SLOTS;

export function isSlot(value: string): value is Slot {
  return value in SLOTS;
}

// Which of a form's cycle bindings a submission should feed. A form is bound
// per-cycle (one binding per cycle+slot), so the binding names the cycle — we
// pick from the form's own bindings rather than re-deriving the cycle from the
// calendar's current term, which would silently drop submissions for any term
// that isn't "live" today. Normally a form drives one staffing slot for one
// cycle; if it's reused across cycles we prefer the live term's binding, else
// the most recently updated one, so the choice is always deterministic.
export function pickStaffingBinding<
  B extends {
    slot: string;
    updatedAt: Date;
    staffingCycle: { termId: string };
  },
>(bindings: B[], currentTermId: string | null): B | undefined {
  return bindings
    .filter(
      (b) =>
        b.slot === "project-bids" ||
        b.slot === "intent-to-work" ||
        b.slot === "level-up",
    )
    .sort((a, b) => {
      if (currentTermId) {
        const aLive = a.staffingCycle.termId === currentTermId;
        const bLive = b.staffingCycle.termId === currentTermId;
        if (aLive !== bLive) return aLive ? -1 : 1;
      }
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })[0];
}

// The form bound to a slot for a cycle, with just enough of its latest
// version to surface it to members. `null` when no form is bound.
export type SlotBinding = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
  updatedAt: string;
  // The saved question→column mapping for this binding, parsed/defended.
  // null = not mapped yet (the slot can't interpret submissions).
  mapping: ColumnMapping | null;
  // App-lock config: null = not gated. When set, members in this audience are
  // hard-gated into filling the form before using the app (see gate.server.ts).
  gateAudience: SigningAudience | null;
  gateAudienceGroupId: string | null;
} | null;

export async function getSlotBinding(
  staffingCycleId: string,
  slot: Slot,
): Promise<SlotBinding> {
  const row = await prisma.staffingCycleFormBinding.findUnique({
    where: { staffingCycleId_slot: { staffingCycleId, slot } },
    select: {
      updatedAt: true,
      columnMapping: true,
      gateAudience: true,
      gateAudienceGroupId: true,
      form: {
        select: { id: true, name: true, published: true, publicToken: true },
      },
    },
  });
  if (!row) return null;
  return {
    formId: row.form.id,
    formName: row.form.name,
    published: row.form.published,
    publicToken: row.form.publicToken,
    updatedAt: row.updatedAt.toISOString(),
    mapping: parseColumnMapping(row.columnMapping),
    gateAudience: row.gateAudience,
    gateAudienceGroupId: row.gateAudienceGroupId,
  };
}

// Save the question→column mapping for a binding. The binding must already
// exist (a form is bound first). Shape is validated against the bound form's
// latest version by the caller before this is reached.
export async function setSlotColumnMapping(
  staffingCycleId: string,
  slot: Slot,
  mapping: ColumnMapping,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const binding = await prisma.staffingCycleFormBinding.findUnique({
    where: { staffingCycleId_slot: { staffingCycleId, slot } },
    select: { id: true },
  });
  if (!binding)
    return { ok: false, error: "Bind a form before mapping its columns." };

  await prisma.staffingCycleFormBinding.update({
    where: { id: binding.id },
    data: { columnMapping: mapping as object, updatedById: userId },
  });
  return { ok: true };
}

// Upsert the binding for (cycle, slot). `formId` is validated against an
// existing form so a stale/forged id can't create a dangling binding.
export async function setSlotBinding(
  staffingCycleId: string,
  slot: Slot,
  formId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // SlotFormPicker's "— No form selected —" posts an empty formId: that's an
  // unbind, not a form lookup. deleteMany so clearing an already-clear slot is
  // a no-op instead of a throw. Submissions keep the staffingCycleId and slot
  // they were filled under — unbinding stops new fills reaching this cycle, it
  // doesn't rewrite what's already recorded.
  if (!formId.trim()) {
    await prisma.staffingCycleFormBinding.deleteMany({
      where: { staffingCycleId, slot },
    });
    return { ok: true };
  }

  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { id: true },
  });
  if (!form) return { ok: false, error: "That form no longer exists." };

  await prisma.staffingCycleFormBinding.upsert({
    where: { staffingCycleId_slot: { staffingCycleId, slot } },
    create: { staffingCycleId, slot, formId, updatedById: userId },
    update: { formId, updatedById: userId },
  });
  return { ok: true };
}

// Set (or clear) the app-lock audience for a bound slot. `audience === null`
// turns the lock off. The binding must already exist — you lock the app to a
// form only after binding one. gateAudienceGroupId is reserved for a future
// specific-group option; it's cleared unless the audience is Group.
export async function setSlotGate(
  staffingCycleId: string,
  slot: Slot,
  audience: GateAudience | null,
  groupId: string | null,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const binding = await prisma.staffingCycleFormBinding.findUnique({
    where: { staffingCycleId_slot: { staffingCycleId, slot } },
    select: { id: true },
  });
  if (!binding)
    return { ok: false, error: "Bind a form before locking the app to it." };

  await prisma.staffingCycleFormBinding.update({
    where: { id: binding.id },
    data: {
      gateAudience: audience,
      gateAudienceGroupId: audience === "Group" ? groupId : null,
      updatedById: userId,
    },
  });
  return { ok: true };
}

// Clearing a slot returns it to default (no form surfaced to members).
export async function clearSlotBinding(
  staffingCycleId: string,
  slot: Slot,
): Promise<void> {
  await prisma.staffingCycleFormBinding.deleteMany({
    where: { staffingCycleId, slot },
  });
}

// Forms an admin can pick for any slot: every form that has at least one
// version (an empty form can't be filled). id + name, ordered by name.
export type SelectableForm = {
  id: string;
  name: string;
  published: boolean;
};

export async function listSelectableForms(): Promise<SelectableForm[]> {
  const forms = await prisma.form.findMany({
    where: { versions: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, published: true },
  });
  return forms;
}
