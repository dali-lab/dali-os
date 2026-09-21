import { describe, it, expect } from "vitest";
import { buildTimelineEpics, type TimelineEpicRow, type TimelineTaskRow } from "../timeline-epics";

const D = (iso: string) => new Date(iso);

function epicRow(over: Partial<TimelineEpicRow> = {}): TimelineEpicRow {
  return {
    id: "e1",
    title: "Epic 1",
    description: null,
    status: "Open",
    startsAt: null,
    endsAt: null,
    stories: [],
    ...over,
  };
}

function taskRow(over: Partial<TimelineTaskRow> = {}): TimelineTaskRow {
  return {
    id: "t1",
    epicId: null,
    storyId: null,
    startsAt: null,
    dueAt: null,
    title: "Task",
    status: "Todo",
    assignees: [],
    ...over,
  };
}

describe("buildTimelineEpics", () => {
  it("hangs an epic-linked task with no story directly under the epic", () => {
    const [epic] = buildTimelineEpics({
      epics: [epicRow({ startsAt: D("2026-01-05"), endsAt: D("2026-01-20") })],
      tasks: [
        taskRow({
          id: "direct",
          epicId: "e1",
          storyId: null,
          startsAt: D("2026-01-06"),
          dueAt: D("2026-01-10"),
        }),
      ],
    });
    expect(epic.stories).toHaveLength(0);
    expect(epic.tasks.map((t) => t.id)).toEqual(["direct"]);
  });

  it("widens an otherwise-undated epic to cover its direct tasks", () => {
    const [epic] = buildTimelineEpics({
      epics: [epicRow()], // no explicit dates, no stories
      tasks: [
        taskRow({ id: "d", epicId: "e1", startsAt: D("2026-02-02"), dueAt: D("2026-02-09") }),
      ],
    });
    // Without the direct-task pass the epic would be null-spanned (unscheduled).
    expect(epic.startsAt).toBe(D("2026-02-02").toISOString());
    expect(epic.endsAt).toBe(D("2026-02-09").toISOString());
  });

  it("still nests story-linked tasks under their story, not the epic", () => {
    const [epic] = buildTimelineEpics({
      epics: [
        epicRow({
          stories: [
            {
              id: "s1",
              title: "Story",
              notes: "n",
              status: "Todo",
              startsAt: D("2026-03-01"),
              endsAt: D("2026-03-10"),
            },
          ],
        }),
      ],
      tasks: [taskRow({ id: "st", epicId: "e1", storyId: "s1", dueAt: D("2026-03-05") })],
    });
    expect(epic.tasks).toHaveLength(0);
    expect(epic.stories[0].tasks.map((t) => t.id)).toEqual(["st"]);
  });

  it("drops a task linked to neither an epic nor a story", () => {
    const [epic] = buildTimelineEpics({
      epics: [epicRow({ startsAt: D("2026-01-05"), endsAt: D("2026-01-20") })],
      tasks: [taskRow({ id: "loose", epicId: null, storyId: null, dueAt: D("2026-01-08") })],
    });
    expect(epic.tasks).toHaveLength(0);
    expect(epic.stories).toHaveLength(0);
  });

  it("keeps the epic placeable from direct tasks even when task bars are omitted", () => {
    const [epic] = buildTimelineEpics({
      epics: [epicRow()],
      tasks: [taskRow({ id: "d", epicId: "e1", startsAt: D("2026-04-01"), dueAt: D("2026-04-05") })],
      includeTasks: false,
    });
    // Bars aren't shipped (partner hub), but the span still resolves so the epic
    // draws rather than falling to "unscheduled".
    expect(epic.tasks).toHaveLength(0);
    expect(epic.startsAt).toBe(D("2026-04-01").toISOString());
    expect(epic.endsAt).toBe(D("2026-04-05").toISOString());
  });
});
