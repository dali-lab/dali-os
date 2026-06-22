import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { ensureStaffingCycle } from "./staffing-cycle";
import { SLOTS, type Slot, getSlotBinding } from "./form-slots";

// The member-facing view of the current cycle's staffing forms. Mirrors what a
// member would otherwise only ever see as an ephemeral My Tasks tile: each
// published, bound slot with the same /forms/fill/:token link, plus whether
// they've already submitted so the page can show "View / update".
export type MemberStaffingForm = {
  slot: Slot;
  slotLabel: string;
  formName: string;
  fillLink: string; // /forms/fill/:token (same link as the My Tasks tile)
  submitted: boolean;
  submittedAt: string | null;
};

export async function listMemberStaffingForms(
  userId: string,
): Promise<MemberStaffingForm[]> {
  const term = await currentTerm();
  if (!term) return [];
  const cycle = await ensureStaffingCycle(term.id, term.code);

  const out: MemberStaffingForm[] = [];
  for (const slot of Object.keys(SLOTS) as Slot[]) {
    const binding = await getSlotBinding(cycle.id, slot);
    // Only surface forms a member can actually open & submit.
    if (!binding || !binding.published || !binding.publicToken) continue;

    // Submissions are scoped to this member only — the member page must never
    // surface another member's submissions (CLAUDE.md role-check discipline).
    const last = await prisma.formSubmission.findFirst({
      where: { staffingCycleId: cycle.id, slot, userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    out.push({
      slot,
      slotLabel: SLOTS[slot],
      formName: binding.formName,
      fillLink: `/forms/fill/${binding.publicToken}`,
      submitted: last !== null,
      submittedAt: last?.createdAt.toISOString() ?? null,
    });
  }
  return out;
}
