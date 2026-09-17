import { isCore, isLabMentor } from "~/lib/roles";

// Area gate for `/mentorship` surfaces. Mentees are excluded: only active lab
// mentors and Core/Admin may enter. Once past this gate every lab mentor may
// read every mentor note lab-wide — see `canViewMentorNote` / `mentorNoteWhere`.
// Editing stays narrower and is enforced at the write paths, not here: a note
// is editable only by its author or Core, and a pairing only by Core.
export async function canViewMentorship(userId: string): Promise<boolean> {
  if (await isCore(userId)) return true;
  return isLabMentor(userId);
}

/**
 * MentorNote list/filter scope. Every lab mentor (and Core/Admin) can read all
 * mentor notes, so both return an empty — unrestricted — filter. A caller who
 * is neither (only reachable off the area-gated surfaces) is limited to notes
 * they authored.
 */
export async function mentorNoteWhere(
  userId: string,
): Promise<Record<string, unknown>> {
  if (await isCore(userId)) return {};
  if (await isLabMentor(userId)) return {};
  return { mentorId: userId };
}

/**
 * MentorshipPair list/filter scope. Same rule as notes: every lab mentor (and
 * Core/Admin) sees all pairs; anyone else is limited to pairs they mentor.
 */
export async function mentorshipPairWhere(
  userId: string,
): Promise<Record<string, unknown>> {
  if (await isCore(userId)) return {};
  if (await isLabMentor(userId)) return {};
  return { mentorUserId: userId };
}

/** Single-note read check. The note's author, any lab mentor, or Core/Admin. */
export async function canViewMentorNote(
  userId: string,
  note: { mentorId: string },
): Promise<boolean> {
  if (await isCore(userId)) return true;
  if (note.mentorId === userId) return true;
  return isLabMentor(userId);
}
