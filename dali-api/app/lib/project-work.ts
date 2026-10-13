// Assigned project tasks as the My Tasks surfaces show them (the "Project
// work" tab). Client-safe: the query lives
// in ~/lib/tasks, this file is the shape plus the card's status line.

import { STALE_DAYS } from "~/projects/lib/project-status";

export const OPEN_WORK_STATUSES = ["Todo", "InProgress", "InReview"] as const;

export type ProjectWorkItem = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  status: (typeof OPEN_WORK_STATUSES)[number];
  // Null = in the project backlog. endsOn is the sprint's last day (UTC midnight).
  sprint: { label: string; endsOn: string } | null;
  carryoverCount: number;
  activityAt: string;
  link: string;
};

export function projectTaskLink(projectId: string, taskId: string): string {
  return `/projects/${projectId}?tab=board&task=${taskId}`;
}

export type ProjectWorkMeta = {
  kind: "carried" | "stale" | "review" | "sprint" | "backlog";
  warn: boolean;
  text: string;
};

const DAY_MS = 86_400_000;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// One line per card, most pressing first: carried beats stale beats review.
// Thresholds match the project status bar (computeProjectStatus).
export function projectWorkMeta(
  item: Pick<ProjectWorkItem, "status" | "sprint" | "carryoverCount" | "activityAt">,
  now: Date = new Date(),
): ProjectWorkMeta {
  const nowMs = now.getTime();
  if (item.carryoverCount > 0) {
    const times = item.carryoverCount === 1 ? "once" : `${item.carryoverCount}×`;
    return { kind: "carried", warn: true, text: `Carried over ${times}` };
  }
  if (item.status === "InProgress") {
    const idle = Math.floor((nowMs - new Date(item.activityAt).getTime()) / DAY_MS);
    if (idle >= STALE_DAYS) {
      return { kind: "stale", warn: true, text: `No updates in ${idle} days` };
    }
  }
  if (item.status === "InReview") return { kind: "review", warn: false, text: "In review" };
  if (item.sprint) {
    return { kind: "sprint", warn: false, text: `${item.sprint.label} · ends ${formatDay(item.sprint.endsOn)}` };
  }
  return { kind: "backlog", warn: false, text: "Backlog" };
}
