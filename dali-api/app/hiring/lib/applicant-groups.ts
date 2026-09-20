import type { CycleApplicants } from "~/generated/prisma/enums";
import { defaultTimeline, type Timeline } from "./cycle-timeline";

// Client-safe helpers for a cycle's `applicants` setting. The server-only
// registry (eligibility, accept side-effects, reviewer defaults) lives in
// applicant-groups.server.ts and re-exports these.

export const APPLICANT_GROUPS: readonly CycleApplicants[] = ["Students", "Interns", "LabMembers"];

export const APPLICANTS_LABELS: Record<CycleApplicants, string> = {
  Students: "Students",
  Interns: "Interns",
  LabMembers: "Lab members",
};

/** Interns and Lab members apply through a member-authed portal with a single
 *  cycle-level form; Students apply through the public CAS portal. */
export function isMemberApplicants(a: CycleApplicants): boolean {
  return a !== "Students";
}

/** Lab members cycles hire into Core, so only Admins run them and plain Core
 *  members and domain leads get no blanket access. */
export function isAdminOnlyCycle(a: CycleApplicants): boolean {
  return a === "LabMembers";
}

/** Where an applicant fills in this cycle's application. */
export function applicantPortalPath(a: CycleApplicants, cycleId: string): string {
  switch (a) {
    case "Students":
      return `/portal/apply/${cycleId}`;
    case "Interns":
      return `/fellowship/${cycleId}`;
    case "LabMembers":
      return `/core/apply/${cycleId}`;
  }
}

/** Starting stages for a new cycle, by group. Editable until the cycle opens.
 *  Member cycles never used challenges, interviews or blind review; Interns
 *  cycles also skipped the first delib round (see defaultTimelineFor). */
export const DEFAULT_STAGES: Record<
  CycleApplicants,
  { hasChallenges: boolean; hasInterviews: boolean; anonymizeReview: boolean }
> = {
  Students: { hasChallenges: true, hasInterviews: true, anonymizeReview: true },
  Interns: { hasChallenges: false, hasInterviews: false, anonymizeReview: false },
  LabMembers: { hasChallenges: false, hasInterviews: false, anonymizeReview: false },
};

/** A new cycle's timeline for its group: the standard one, minus Interviews
 *  where the group doesn't interview and the first round for Interns. */
export function defaultTimelineFor(applicants: CycleApplicants): Timeline {
  return defaultTimeline({
    firstDelib: applicants !== "Interns",
    interviews: DEFAULT_STAGES[applicants].hasInterviews,
  });
}
