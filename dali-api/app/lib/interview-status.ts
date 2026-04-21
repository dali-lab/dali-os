import type { InterviewStatus } from "~/generated/prisma/enums";

// An Interview is "active" when it's still on an applicant's calendar. After
// the NeedsReassignment removal this is a single value, but the tuple shape
// is kept so any future transient status only needs to be added here and
// every callsite picks it up automatically.
export const ACTIVE_INTERVIEW_STATUSES = ["Scheduled"] as const;
export type ActiveInterviewStatus = (typeof ACTIVE_INTERVIEW_STATUSES)[number];

export function isActiveInterviewStatus(s: InterviewStatus): boolean {
  return (ACTIVE_INTERVIEW_STATUSES as readonly InterviewStatus[]).includes(s);
}

// Given a DomainApplication's interviews array, return the single active
// interview (or null). Callers that need the current live interview should
// go through this helper so "active" is defined in one place.
export function activeInterview<T extends { status: InterviewStatus }>(
  interviews: T[] | undefined | null,
): T | null {
  return (interviews ?? []).find((i) => isActiveInterviewStatus(i.status)) ?? null;
}
