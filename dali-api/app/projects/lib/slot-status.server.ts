import { prisma } from "~/lib/db";
import { SLOTS, type Slot, getSlotBinding } from "./form-slots";

// Per-slot guardrail status for the Core staffing boards. Binding a form to a
// slot, mapping its columns, and actually telling members about it are three
// independent steps; this surfaces all three so a slot that's bound-but-unsent
// (nobody can apply) or sent-but-unmapped (submissions can't be interpreted)
// is visible rather than silent.
export type SlotStatus = {
  slot: Slot;
  slotLabel: string;
  bound: boolean;
  mappingComplete: boolean;
  sentToCount: number; // distinct recipients who got an announcement w/ this form
};

export async function deriveSlotStatus(cycleId: string): Promise<SlotStatus[]> {
  return Promise.all(
    (Object.keys(SLOTS) as Slot[]).map(async (slot) => {
      const binding = await getSlotBinding(cycleId, slot);
      let sentToCount = 0;
      if (binding) {
        // No Notification->cycle link; key off the bound form id. Counts every
        // announcement that attached this form (answers "did anyone get
        // told?", not an exact per-cycle audience).
        const recips = await prisma.notification.findMany({
          where: { formId: binding.formId },
          distinct: ["recipientUserId"],
          select: { recipientUserId: true },
        });
        sentToCount = recips.length;
      }
      return {
        slot,
        slotLabel: SLOTS[slot],
        bound: binding !== null,
        mappingComplete: binding?.mapping != null,
        sentToCount,
      };
    }),
  );
}
