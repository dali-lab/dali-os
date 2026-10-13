import { fullName } from "~/lib/display";
import type { EpicStatus, TimelineEpic, TimelineTask } from "../components/EpicsTimeline";
import { deriveEpicStatus, epicSprintSpan, type EpicDerivedStatus } from "./sprints";

export type TimelineEpicRow = {
  id: string;
  title: string;
  description: string | null;
  cancelledAt: Date | null;
  stories: {
    id: string;
    title: string;
    notes: string | null;
    status: string;
    successMetric?: string | null;
    acceptanceCriteria?: string | null;
  }[];
};

// Detail fields are only read when `includeTasks`, so a caller that hides the
// task level (the partner hub) can select the sprint alone.
export type TimelineTaskRow = {
  id: string;
  epicId: string | null;
  status: string;
  sprint: { startsOn: Date; endsOn: Date } | null;
  title?: string;
  assignees?: {
    user: { id: string; firstName: string | null; lastName: string | null };
  }[];
  commentCount?: number;
  fileCount?: number;
};

export const EPIC_STATUS_FROM_DERIVED: Record<EpicDerivedStatus, EpicStatus> = {
  NotStarted: "Open",
  InProgress: "InProgress",
  Done: "Done",
  Cancelled: "Cancelled",
};

/** A story captured by name only — the design's amber dot. */
export function isRequirementIncomplete(st: TimelineEpicRow["stories"][number]): boolean {
  return !st.notes && !st.successMetric && !st.acceptanceCriteria;
}

/**
 * Epics as the timeline draws them: each spans the first through the last
 * sprint holding one of its tasks, with sprinted tasks as one-sprint bars.
 */
export function buildTimelineEpics({
  epics,
  tasks,
  includeTasks = true,
}: {
  epics: TimelineEpicRow[];
  tasks: TimelineTaskRow[];
  includeTasks?: boolean;
}): TimelineEpic[] {
  const byEpic = new Map<string, TimelineTaskRow[]>();
  for (const t of tasks) {
    if (!t.epicId) continue;
    const bucket = byEpic.get(t.epicId);
    if (bucket) bucket.push(t);
    else byEpic.set(t.epicId, [t]);
  }

  return epics.map((e) => {
    const epicTasks = byEpic.get(e.id) ?? [];
    const span = epicSprintSpan(
      epicTasks.map((t) =>
        t.sprint ? { startsOn: t.sprint.startsOn.getTime(), endsOn: t.sprint.endsOn.getTime() } : null,
      ),
    );
    const counted = epicTasks.filter((t) => t.status !== "Cancelled");
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      status: EPIC_STATUS_FROM_DERIVED[
        deriveEpicStatus(e, epicTasks.map((t) => t.status))
      ],
      startsAt: span ? new Date(span.startsOn).toISOString() : null,
      endsAt: span ? new Date(span.endsOn).toISOString() : null,
      stories: [],
      requirements: e.stories.map((st) => ({
        id: st.id,
        title: st.title,
        status: st.status as TimelineEpic["requirements"][number]["status"],
        incomplete: isRequirementIncomplete(st),
      })),
      tasks: includeTasks
        ? epicTasks
            .filter((t): t is TimelineTaskRow & { sprint: NonNullable<TimelineTaskRow["sprint"]> } =>
              t.sprint !== null,
            )
            .sort((a, z) => a.sprint.startsOn.getTime() - z.sprint.startsOn.getTime())
            .map(
              (t): TimelineTask => ({
                id: t.id,
                title: t.title ?? "",
                status: t.status as TimelineTask["status"],
                startsAt: t.sprint.startsOn.toISOString(),
                endsAt: t.sprint.endsOn.toISOString(),
                assignees: (t.assignees ?? []).map((a) => ({ id: a.user.id, name: fullName(a.user) })),
                commentCount: t.commentCount ?? 0,
                fileCount: t.fileCount ?? 0,
              }),
            )
        : [],
      progress: {
        done: counted.filter((t) => t.status === "Done").length,
        total: counted.length,
      },
    };
  });
}
