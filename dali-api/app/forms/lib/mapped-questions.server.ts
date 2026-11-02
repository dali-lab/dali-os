import { prisma } from "~/lib/db.server";
import { isSlot, SLOTS } from "~/projects/lib/form-slots";
import { isQuestionEntry, parseColumnMapping } from "~/projects/lib/slot-roles";

// Question key -> the staffing feature that reads its answer, across every
// binding the form has whatever its slot. Those answers feed real data after
// submission, so the question can't be conditional.
export async function mappedQuestionFeatures(
  formId: string,
): Promise<Map<string, string>> {
  const bindings = await prisma.staffingCycleFormBinding.findMany({
    where: { formId },
    select: { slot: true, columnMapping: true },
  });
  const mapped = new Map<string, string>();
  for (const binding of bindings) {
    const feature = isSlot(binding.slot) ? SLOTS[binding.slot] : binding.slot;
    for (const entry of parseColumnMapping(binding.columnMapping)?.entries ?? []) {
      if (isQuestionEntry(entry) && !mapped.has(entry.questionKey)) {
        mapped.set(entry.questionKey, feature);
      }
    }
  }
  return mapped;
}
