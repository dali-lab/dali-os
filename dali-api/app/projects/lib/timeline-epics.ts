import { fullName } from "~/lib/display";
import type {
  EpicStatus,
  TimelineEpic,
  TimelineStory,
  TimelineTask,
} from "../components/EpicsTimeline";

// The rows the builder reads, written structurally so a Prisma select that
// carries at least these fields satisfies them.

export type TimelineEpicRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  stories: {
    id: string;
    title: string;
    notes: string | null;
    status: string;
    startsAt: Date | null;
    endsAt: Date | null;
  }[];
};

export type TimelineSprintRow = {
  epicId: string | null;
  startsAt: Date;
  endsAt: Date;
};

// Span fields are always read (they place the story above them); the rest is
// only read when `includeTasks`, so a caller that hides the task level can
// select dates alone rather than joining assignees it will never draw.
export type TimelineTaskRow = {
  id: string;
  storyId: string | null;
  startsAt: Date | null;
  dueAt: Date | null;
  title?: string;
  status?: string;
  assignees?: {
    user: { id: string; firstName: string | null; lastName: string | null };
  }[];
  // Card-style counts for the timeline hover (same facts as the board thumbnail).
  commentCount?: number;
  fileCount?: number;
};

/**
 * Resolve every epic, story and task onto the day grid the timeline draws.
 *
 * Resolution is deliberately acyclic: epic *base* span (explicit dates, else
 * the union of its sprint dates) → story span (explicit, else the union of its
 * self-dated tasks, else the epic base) → task span (own dates, else the
 * story's) → epic *final* span (base widened to cover its stories).
 *
 * `includeTasks: false` still runs the task pass — a story with no dates of its
 * own is placed by the tasks under it either way — but leaves the task arrays
 * empty, so a surface that doesn't draw task bars (the partner hub) gets story
 * bars sitting exactly where the internal timeline puts them without shipping
 * task titles and assignees it never renders.
 */
export function buildTimelineEpics({
  epics,
  sprints,
  tasks,
  includeTasks = true,
}: {
  epics: TimelineEpicRow[];
  sprints: TimelineSprintRow[];
  tasks: TimelineTaskRow[];
  includeTasks?: boolean;
}): TimelineEpic[] {
  const tasksByStoryId = new Map<string, TimelineTaskRow[]>();
  for (const t of tasks) {
    if (!t.storyId) continue;
    const bucket = tasksByStoryId.get(t.storyId);
    if (bucket) bucket.push(t);
    else tasksByStoryId.set(t.storyId, [t]);
  }

  return epics.map((e) => {
    const epicSprints = sprints.filter((s) => s.epicId === e.id);
    const sprintStarts = epicSprints.map((s) => s.startsAt.getTime());
    const sprintEnds = epicSprints.map((s) => s.endsAt.getTime());
    const sprintStartMs = sprintStarts.length ? Math.min(...sprintStarts) : null;
    const sprintEndMs = sprintEnds.length ? Math.max(...sprintEnds) : null;

    let startMs = e.startsAt?.getTime() ?? sprintStartMs;
    let endMs = e.endsAt?.getTime() ?? sprintEndMs;
    if (sprintStartMs != null && startMs != null) startMs = Math.min(startMs, sprintStartMs);
    if (sprintEndMs != null && endMs != null) endMs = Math.max(endMs, sprintEndMs);

    const stories: TimelineStory[] = [];
    for (const st of e.stories) {
      const storyTasks = tasksByStoryId.get(st.id) ?? [];

      // A task is "self-dated" only when it carries enough to place itself.
      // dueAt alone is a valid one-ended span (start := due), so a task with a
      // deadline and no start still anchors its story.
      const selfDated = storyTasks
        .map((t) => {
          const ts = t.startsAt?.getTime() ?? t.dueAt?.getTime() ?? null;
          const te = t.dueAt?.getTime() ?? t.startsAt?.getTime() ?? null;
          return ts != null && te != null ? { ts, te: Math.max(ts, te) } : null;
        })
        .filter((x): x is { ts: number; te: number } => x !== null);

      let storyStartMs = st.startsAt?.getTime() ?? null;
      let storyEndMs = st.endsAt?.getTime() ?? null;
      if (storyStartMs == null && selfDated.length) {
        storyStartMs = Math.min(...selfDated.map((x) => x.ts));
      }
      if (storyEndMs == null && selfDated.length) {
        storyEndMs = Math.max(...selfDated.map((x) => x.te));
      }
      storyStartMs ??= startMs;
      storyEndMs ??= endMs;
      // Nothing anywhere up the chain has a date — the story can't be placed.
      if (storyStartMs == null || storyEndMs == null) continue;
      if (storyEndMs < storyStartMs) storyEndMs = storyStartMs;

      const sStart = storyStartMs;
      const sEnd = storyEndMs;
      stories.push({
        id: st.id,
        title: st.title,
        description: st.notes,
        // Mirrors isStoryIncomplete in EpicSprintManager: title only.
        incomplete: !st.notes && !st.startsAt && !st.endsAt,
        status: st.status as TimelineStory["status"],
        startsAt: new Date(sStart).toISOString(),
        endsAt: new Date(sEnd).toISOString(),
        tasks: includeTasks
          ? storyTasks.map((t): TimelineTask => {
              const ts = t.startsAt?.getTime() ?? t.dueAt?.getTime() ?? sStart;
              const te = t.dueAt?.getTime() ?? t.startsAt?.getTime() ?? sEnd;
              return {
                id: t.id,
                title: t.title ?? "",
                status: (t.status ?? "Todo") as TimelineTask["status"],
                startsAt: new Date(ts).toISOString(),
                endsAt: new Date(Math.max(ts, te)).toISOString(),
                assignees: (t.assignees ?? []).map((a) => ({
                  id: a.user.id,
                  name: fullName(a.user),
                })),
                commentCount: t.commentCount ?? 0,
                fileCount: t.fileCount ?? 0,
              };
            })
          : [],
      });
    }

    // Widen the epic bar to contain every story bar drawn inside it.
    for (const st of stories) {
      const ss = Date.parse(st.startsAt);
      const se = Date.parse(st.endsAt);
      startMs = startMs == null ? ss : Math.min(startMs, ss);
      endMs = endMs == null ? se : Math.max(endMs, se);
    }

    return {
      id: e.id,
      title: e.title,
      description: e.description,
      status: e.status as EpicStatus,
      startsAt: startMs != null ? new Date(startMs).toISOString() : null,
      endsAt: endMs != null ? new Date(endMs).toISOString() : null,
      stories,
    };
  });
}
