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

// Span fields are always read (they place the story above them); the rest is
// only read when `includeTasks`, so a caller that hides the task level can
// select dates alone rather than joining assignees it will never draw.
export type TimelineTaskRow = {
  id: string;
  // A task hangs under its story when it has one, else directly under its epic.
  // Optional: a caller that only ever passes story-linked rows (the partner
  // hub) needn't select it — a row without an epicId is simply never treated as
  // epic-direct.
  epicId?: string | null;
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
 * Resolution is deliberately acyclic: epic *base* span (explicit dates) → story
 * span (explicit, else the union of its self-dated tasks, else the epic base) →
 * task span (own dates, else the story's) → epic *final* span (base widened to
 * cover its stories).
 *
 * `includeTasks: false` still runs the task pass — a story with no dates of its
 * own is placed by the tasks under it either way — but leaves the task arrays
 * empty, so a surface that doesn't draw task bars (the partner hub) gets story
 * bars sitting exactly where the internal timeline puts them without shipping
 * task titles and assignees it never renders.
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
  const tasksByStoryId = new Map<string, TimelineTaskRow[]>();
  // Tasks linked straight to an epic (no story) hang under the epic bar itself,
  // as peers of its stories — without this bucket they had nowhere to sit and
  // were dropped from the timeline entirely. A task with neither an epic nor a
  // story is genuinely unplaceable and stays off.
  const directTasksByEpicId = new Map<string, TimelineTaskRow[]>();
  for (const t of tasks) {
    if (t.storyId) {
      const bucket = tasksByStoryId.get(t.storyId);
      if (bucket) bucket.push(t);
      else tasksByStoryId.set(t.storyId, [t]);
    } else if (t.epicId) {
      const bucket = directTasksByEpicId.get(t.epicId);
      if (bucket) bucket.push(t);
      else directTasksByEpicId.set(t.epicId, [t]);
    }
  }

  return epics.map((e) => {
    let startMs = e.startsAt?.getTime() ?? null;
    let endMs = e.endsAt?.getTime() ?? null;

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

    // Epic-direct tasks (no story) resolve against their own dates, else the
    // epic's span so far. Each self-dated one widens the epic the way stories
    // do, so a task dated outside the epic still sits inside its bar. Span
    // widening runs even when `includeTasks` is off (so an epic carried only by
    // loose tasks stays placeable for the partner hub); the task bars ship only
    // when it's on, matching how the story pass leaves task arrays empty there.
    const tasks: TimelineTask[] = [];
    for (const t of directTasksByEpicId.get(e.id) ?? []) {
      const ts = t.startsAt?.getTime() ?? t.dueAt?.getTime() ?? startMs;
      const te = t.dueAt?.getTime() ?? t.startsAt?.getTime() ?? endMs;
      if (ts == null || te == null) continue;
      const s = ts;
      const en = Math.max(ts, te);
      startMs = startMs == null ? s : Math.min(startMs, s);
      endMs = endMs == null ? en : Math.max(endMs, en);
      if (!includeTasks) continue;
      tasks.push({
        id: t.id,
        title: t.title ?? "",
        status: (t.status ?? "Todo") as TimelineTask["status"],
        startsAt: new Date(s).toISOString(),
        endsAt: new Date(en).toISOString(),
        assignees: (t.assignees ?? []).map((a) => ({
          id: a.user.id,
          name: fullName(a.user),
        })),
        commentCount: t.commentCount ?? 0,
        fileCount: t.fileCount ?? 0,
      });
    }

    return {
      id: e.id,
      title: e.title,
      description: e.description,
      status: e.status as EpicStatus,
      startsAt: startMs != null ? new Date(startMs).toISOString() : null,
      endsAt: endMs != null ? new Date(endMs).toISOString() : null,
      stories,
      tasks,
    };
  });
}
