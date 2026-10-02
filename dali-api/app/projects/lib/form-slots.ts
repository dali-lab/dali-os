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
// cycle; if it's bound to several, the most recently bound one wins, so the
// choice follows the manager's last action and is always deterministic.
//
// Deliberately NOT "the live term's binding wins": intent-to-work for the
// next term is collected during this one, so preferring the current term sent
// 27W intent to the 26F cycle for every form bound to both.
export function pickStaffingBinding<
  B extends {
    slot: string;
    updatedAt: Date;
  },
>(bindings: B[]): B | undefined {
  return bindings
    .filter(
      (b) =>
        b.slot === "project-bids" ||
        b.slot === "intent-to-work" ||
        b.slot === "level-up",
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
}

// Every cycle this form is bound to for one slot. The one-and-done gate spans
// all of them: which cycle a fill records against is decided per-fill by
// pickStaffingBinding, so keying the gate on a single cycle lets a re-bind
// reopen a form the member already filled under another cycle.
export async function boundSlotCycleIds(
  formId: string,
  slot: string,
): Promise<string[]> {
  const rows = await prisma.staffingCycleFormBinding.findMany({
    where: { formId, slot },
    select: { staffingCycleId: true },
  });
  return rows.map((r) => r.staffingCycleId);
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
// `allowMove` is the caller's acknowledgement that binding this form here
// will take it off whatever cycle currently holds it. Defaults to false so a
// non-interactive caller (MCP, a stale picker) can't silently stop another
// cycle's collection; the picker asks first and then passes it.
export async function setSlotBinding(
  staffingCycleId: string,
  slot: Slot,
  formId: string,
  userId: string,
  opts?: { allowMove?: boolean },
): Promise<{ ok: true; movedFrom?: string } | { ok: false; error: string }> {
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

  // One cycle per form per slot. A fill is addressed by the form's token and
  // carries no cycle, so two bindings make "which cycle do these answers feed"
  // unanswerable — pickStaffingBinding has to guess, and the one-and-done gate
  // spans both. Binding here MOVES the form, carrying its column mapping and
  // app-lock config so the round that's starting doesn't have to be re-set up.
  const held = await prisma.staffingCycleFormBinding.findFirst({
    where: { formId, slot, staffingCycleId: { not: staffingCycleId } },
    select: {
      id: true,
      columnMapping: true,
      gateAudience: true,
      gateAudienceGroupId: true,
      staffingCycle: { select: { name: true } },
    },
  });
  if (held && !opts?.allowMove) {
    return {
      ok: false,
      error: `This form is already collecting for ${held.staffingCycle.name}. Confirm the move, or pick a different form.`,
    };
  }

  const carried = held
    ? {
        columnMapping: held.columnMapping ?? undefined,
        gateAudience: held.gateAudience,
        gateAudienceGroupId: held.gateAudienceGroupId,
      }
    : {};

  await prisma.$transaction(async (tx) => {
    if (held)
      await tx.staffingCycleFormBinding.delete({ where: { id: held.id } });
    await tx.staffingCycleFormBinding.upsert({
      where: { staffingCycleId_slot: { staffingCycleId, slot } },
      create: { staffingCycleId, slot, formId, updatedById: userId, ...carried },
      update: { formId, updatedById: userId, ...carried },
    });
  });
  return held
    ? { ok: true, movedFrom: held.staffingCycle.name }
    : { ok: true };
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
// `boundToCycleName` is set when another cycle holds this form for the slot —
// picking it there is a move, so the picker warns before saving.
export type SelectableForm = {
  id: string;
  name: string;
  published: boolean;
  boundToCycleName?: string;
};

export async function listSelectableForms(opts?: {
  slot: Slot;
  exceptCycleId: string;
}): Promise<SelectableForm[]> {
  const forms = await prisma.form.findMany({
    where: { versions: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, published: true },
  });
  if (!opts) return forms;

  const held = await prisma.staffingCycleFormBinding.findMany({
    where: { slot: opts.slot, staffingCycleId: { not: opts.exceptCycleId } },
    select: { formId: true, staffingCycle: { select: { name: true } } },
  });
  const heldBy = new Map(held.map((b) => [b.formId, b.staffingCycle.name]));
  return forms.map((f) => {
    const cycleName = heldBy.get(f.id);
    return cycleName ? { ...f, boundToCycleName: cycleName } : f;
  });
}
