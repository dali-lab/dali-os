import { delibRounds, hasInterviews, type Timeline, type TimelineBlock } from "./cycle-timeline";

// What each block of a cycle's timeline (see cycle-timeline.ts) asks of the
// hiring lead, and how its weeks map to dates. The setup page renders a tab
// per block with its tasks; whether each task is done comes from real data
// (cycle-phases.server.ts). Client-safe: no Prisma here.

export type BlockTask = { key: string; label: string };

/** The tasks a block carries. Round tasks are keyed `round:<id>`. */
export function tasksForBlock(t: Timeline, b: TimelineBlock, opts: { hasChallenges: boolean }): BlockTask[] {
  if (b.kind === "delib") {
    const round = delibRounds(t).find((r) => r.id === b.id);
    return [
      { key: `round:${b.id}`, label: `Hold ${b.label}` },
      ...(round?.leadsToInterviews ? [{ key: "interviewInvites", label: "Send interview invites" }] : []),
    ];
  }
  switch (b.key) {
    case "setup":
      return [
        { key: "domains", label: "Finalize hiring domains" },
        { key: "applicationDates", label: "Set the application open and close dates" },
        ...(opts.hasChallenges ? [{ key: "challenges", label: "Finalize domain challenges" }] : []),
        { key: "applicationForm", label: "Finalize the general application" },
        { key: "rubrics", label: "Finalize domain and general rubrics" },
        { key: "openApplications", label: "Open applications" },
      ];
    case "review":
      return [
        { key: "reviewers", label: "Finalize the reviewer roster" },
        ...(hasInterviews(t) ? [{ key: "interviewers", label: "Finalize the interviewer roster" }] : []),
        { key: "reviews", label: "Finish application review" },
      ];
    case "interviews":
      return [
        { key: "interviewSchedule", label: "Finalize the interview schedule" },
        { key: "conductInterviews", label: "Conduct interviews" },
      ];
    case "decisions":
      return [{ key: "sendDecisions", label: "Send out decisions" }];
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A block's dates within the term: from the start of its first week to the
 *  start of the week after its last (end exclusive). */
export function blockDates(termStart: Date, weeks: [number, number]): { start: Date; end: Date } {
  const t = termStart.getTime();
  return {
    start: new Date(t + (weeks[0] - 1) * WEEK_MS),
    end: new Date(t + weeks[1] * WEEK_MS),
  };
}

/** Which week of the term `now` falls in (1-indexed; 0 or less before it). */
export function termWeek(termStart: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - termStart.getTime()) / WEEK_MS) + 1;
}

/** Default application window: opens as Week 4 starts, closes at the end of
 *  Week 5. Returned as calendar dates (the close deadline is end of that day). */
export function defaultApplicationWindow(termStart: Date): { open: Date; closeDay: Date } {
  const t = termStart.getTime();
  return { open: new Date(t + 3 * WEEK_MS), closeDay: new Date(t + 5 * WEEK_MS - DAY_MS) };
}

export type PhaseStatus = "done" | "current" | "overdue" | "upcoming";

/** Where a block stands given its tasks and today's date. Undated (no term)
 *  blocks are only ever done or upcoming. */
export function phaseStatus(
  tasksDone: boolean[],
  dates: { start: Date; end: Date } | null,
  now: Date = new Date(),
): PhaseStatus {
  if (tasksDone.length > 0 && tasksDone.every(Boolean)) return "done";
  if (!dates) return "upcoming";
  if (now >= dates.end) return "overdue";
  if (now >= dates.start) return "current";
  return "upcoming";
}
