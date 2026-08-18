import { prisma } from "~/lib/db";
import { SLOTS, type Slot } from "./form-slots";

// The member-facing view of the open staffing round's forms. Mirrors what a
// member would otherwise only ever see as an ephemeral My Tasks tile: each
// published, bound slot with the same /forms/fill/:token link, plus whether
// they've already submitted so the page can show "View / update".
//
// The round is resolved per slot from the most recently bound published form,
// NOT from the calendar's current term. Bidding for term N+1 happens during
// term N — in August the live term is 26X while Core has already bound the
// cycle's forms to 26F — so keying off currentTerm() pointed this block at the
// previous round: it reported "Not submitted" to everyone who had filled the
// live form, and its fill link opened the stale one. Recency is what tracks
// Core rebinding a slot when a new round opens. (form-slots.pickStaffingBinding
// solves the same problem for submission routing, but prefers the live term
// first, which is exactly the preference that breaks here.)
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
  const out: MemberStaffingForm[] = [];
  for (const slot of Object.keys(SLOTS) as Slot[]) {
    // Only surface forms a member can actually open & submit, and let the
    // filter pick the round: the newest binding to a published, fillable form.
    const binding = await prisma.staffingCycleFormBinding.findFirst({
      where: {
        slot,
        form: { published: true, publicToken: { not: null } },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        staffingCycleId: true,
        form: { select: { name: true, publicToken: true } },
      },
    });
    if (!binding?.form.publicToken) continue;

    // Scoped to the binding's own cycle, so a submission counts only against
    // the round it was made in. Scoped to this member only — the member page
    // must never surface another member's submissions (CLAUDE.md role-check
    // discipline).
    const last = await prisma.formSubmission.findFirst({
      where: { staffingCycleId: binding.staffingCycleId, slot, userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    out.push({
      slot,
      slotLabel: SLOTS[slot],
      formName: binding.form.name,
      fillLink: `/forms/fill/${binding.form.publicToken}`,
      submitted: last !== null,
      submittedAt: last?.createdAt.toISOString() ?? null,
    });
  }
  return out;
}
