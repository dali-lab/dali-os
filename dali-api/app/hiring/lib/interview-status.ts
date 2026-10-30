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

// The assignment that lets a member open an interview. While the interview is
// live only an Active one counts, so someone who declined or was swapped off
// is out like anyone who was never assigned. Once it's over, past assignments
// keep it readable from old links.
export function viewerAssignment<
  T extends { status: string; cycleInterviewer: { userId: string } },
>(interview: { status: InterviewStatus; assignments: T[] }, userId: string): T | null {
  const mine = interview.assignments.filter((a) => a.cycleInterviewer.userId === userId);
  const active = mine.find((a) => a.status === "Active");
  if (active) return active;
  return isActiveInterviewStatus(interview.status) ? null : (mine[0] ?? null);
}

// My work's interview list: still-to-come first (soonest at top), then the
// ones already conducted (most recent at top). An interview is past once it
// is Completed or its slot has ended, whichever comes first.
export function splitInterviewsByTime<
  T extends { interview: { status: InterviewStatus; startTime: string | Date; endTime: string | Date } },
>(rows: T[], now: Date): { upcoming: T[]; past: T[] } {
  const isPast = (r: T) =>
    r.interview.status === "Completed" || new Date(r.interview.endTime).getTime() <= now.getTime();
  const start = (r: T) => new Date(r.interview.startTime).getTime();
  return {
    upcoming: rows.filter((r) => !isPast(r)).sort((a, b) => start(a) - start(b)),
    past: rows.filter(isPast).sort((a, b) => start(b) - start(a)),
  };
}
