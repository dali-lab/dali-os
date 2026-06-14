import { isCore, isLabMentor } from "~/lib/roles";

// Mentorship surfaces (hub, notes browser, per-note read, pairings list) are
// readable by any active lab mentor or Core member. The check intentionally
// does not scope to "mentor of this specific mentee" — see the lab's
// mentorship visibility rule (mentors are treated as a collective; only
// mentees are excluded).
export async function canViewMentorship(userId: string): Promise<boolean> {
  if (await isCore(userId)) return true;
  return isLabMentor(userId);
}
