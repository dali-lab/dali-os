// Assigned project tasks as the My Tasks surfaces show them (the "Project
// work" tab behind the `my-project-work` flag). Client-safe: the query lives
// in ~/lib/tasks, this file is the shape plus the card's status line.

import { STALE_DAYS } from "~/projects/lib/project-status";

export const OPEN_WORK_STATUSES = ["Todo", "InProgress", "InReview"] as const;

export type ProjectWorkItem = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  status: (typeof OPEN_WORK_STATUSES)[number];
  dueAt: string | null;
  activityAt: string;
  link: string;
};

export function projectTaskLink(projectId: string, taskId: string): string {
  return `/projects/${projectId}?tab=board&task=${taskId}`;
}

export type ProjectWorkMeta = {
  kind: "overdue" | "stale" | "review" | "due" | "none";
  warn: boolean;
  text: string;
};

const DAY_MS = 86_400_000;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// One line per card, most pressing first: overdue beats stale beats review.
// Thresholds match the project status bar (computeProjectStatus).
export function projectWorkMeta(
  item: Pick<ProjectWorkItem, "status" | "dueAt" | "activityAt">,
  now: Date = new Date(),
): ProjectWorkMeta {
  const nowMs = now.getTime();
  if (item.dueAt && new Date(item.dueAt).getTime() < nowMs) {
    return { kind: "overdue", warn: true, text: `Overdue · was due ${formatDay(item.dueAt)}` };
  }
  if (item.status === "InProgress") {
    const idle = Math.floor((nowMs - new Date(item.activityAt).getTime()) / DAY_MS);
    if (idle >= STALE_DAYS) {
      return { kind: "stale", warn: true, text: `No updates in ${idle} days` };
    }
  }
  if (item.status === "InReview") return { kind: "review", warn: false, text: "In review" };
  if (item.dueAt) return { kind: "due", warn: false, text: `Due ${formatDay(item.dueAt)}` };
  return { kind: "none", warn: false, text: "No due date" };
}
