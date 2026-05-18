import { prisma } from "~/lib/db";

// A "form slot" is a named place in the app that expects an admin-chosen
// generic Form, scoped to one staffing cycle (i.e. per term). Intent to Work
// and Project Bids are the first two slots; the binding table keys on a free
// string so adding a slot later needs no migration. No binding for a slot =
// nothing selected yet (callers fall back to their default behavior).
export const SLOTS = {
  "intent-to-work": "Intent to Work",
  "project-bids": "Project Bids",
} as const;

export type Slot = keyof typeof SLOTS;

export function isSlot(value: string): value is Slot {
  return value in SLOTS;
}

// The form bound to a slot for a cycle, with just enough of its latest
// version to surface it to members. `null` when no form is bound.
export type SlotBinding = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
  updatedAt: string;
} | null;

export async function getSlotBinding(
  staffingCycleId: string,
  slot: Slot,
): Promise<SlotBinding> {
  const row = await prisma.staffingCycleFormBinding.findUnique({
    where: { staffingCycleId_slot: { staffingCycleId, slot } },
    select: {
      updatedAt: true,
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
  };
}

// Upsert the binding for (cycle, slot). `formId` is validated against an
// existing form so a stale/forged id can't create a dangling binding.
export async function setSlotBinding(
  staffingCycleId: string,
  slot: Slot,
  formId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
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
