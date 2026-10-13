import { describe, it, expect } from "vitest";
import {
  buildTimelineEpics,
  isRequirementIncomplete,
  type TimelineEpicRow,
  type TimelineTaskRow,
} from "../timeline-epics";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const S1 = { startsOn: d("2026-09-16"), endsOn: d("2026-09-22") };
const S3 = { startsOn: d("2026-09-30"), endsOn: d("2026-10-06") };

const epic = (extra: Partial<TimelineEpicRow> = {}): TimelineEpicRow => ({
  id: "e1",
  title: "Auth",
  description: null,
  cancelledAt: null,
  stories: [],
  ...extra,
});
const task = (extra: Partial<TimelineTaskRow>): TimelineTaskRow => ({
  id: "t",
  epicId: "e1",
  status: "Todo",
  sprint: null,
  title: "T",
  assignees: [{ user: { id: "u1", firstName: "Ada", lastName: "Lovelace" } }],
  commentCount: 2,
  fileCount: 1,
  ...extra,
});

describe("buildTimelineEpics", () => {
  it("spans an epic from its first to its last sprinted task", () => {
    const [e] = buildTimelineEpics({
      epics: [epic()],
      tasks: [task({ id: "a", sprint: S3 }), task({ id: "b", sprint: S1 }), task({ id: "c" })],
    });
    expect(e!.startsAt).toBe(S1.startsOn.toISOString());
    expect(e!.endsAt).toBe(S3.endsOn.toISOString());
  });

  it("leaves an epic with nothing sprinted unscheduled", () => {
    const [e] = buildTimelineEpics({ epics: [epic()], tasks: [task({})] });
    expect(e).toMatchObject({ startsAt: null, endsAt: null, tasks: [] });
  });

  it("draws only sprinted tasks, each spanning its sprint, in sprint order", () => {
    const [e] = buildTimelineEpics({
      epics: [epic()],
      tasks: [task({ id: "late", sprint: S3 }), task({ id: "early", sprint: S1 }), task({ id: "backlog" })],
    });
    expect(e!.tasks.map((t) => t.id)).toEqual(["early", "late"]);
    expect(e!.tasks[0]).toEqual({
      id: "early",
      title: "T",
      status: "Todo",
      startsAt: S1.startsOn.toISOString(),
      endsAt: S1.endsOn.toISOString(),
      assignees: [{ id: "u1", name: "Ada Lovelace" }],
      commentCount: 2,
      fileCount: 1,
    });
  });

  it("omits task bars but keeps the span when includeTasks is false", () => {
    const [e] = buildTimelineEpics({
      epics: [epic()],
      tasks: [task({ sprint: S1, title: undefined, assignees: undefined })],
      includeTasks: false,
    });
    expect(e!.tasks).toEqual([]);
    expect(e!.startsAt).toBe(S1.startsOn.toISOString());
  });

  it("only counts tasks of the same epic", () => {
    const [e] = buildTimelineEpics({
      epics: [epic()],
      tasks: [task({ epicId: "other", sprint: S1 }), task({ epicId: null, sprint: S3 })],
    });
    expect(e!.startsAt).toBeNull();
    expect(e!.progress).toEqual({ done: 0, total: 0 });
  });

  it.each([
    [[], "Open"],
    [["Todo"], "Open"],
    [["Todo", "InProgress"], "InProgress"],
    [["Done", "Cancelled"], "Done"],
  ])("derives status from task statuses %j → %s", (statuses, status) => {
    const [e] = buildTimelineEpics({
      epics: [epic()],
      tasks: statuses.map((s, i) => task({ id: `t${i}`, status: s })),
    });
    expect(e!.status).toBe(status);
  });

  it("reports Cancelled for a cancelled epic regardless of its tasks", () => {
    const [e] = buildTimelineEpics({
      epics: [epic({ cancelledAt: new Date() })],
      tasks: [task({ status: "InProgress" })],
    });
    expect(e!.status).toBe("Cancelled");
  });

  it("counts progress over non-cancelled tasks, sprinted or not", () => {
    const [e] = buildTimelineEpics({
      epics: [epic()],
      tasks: [
        task({ id: "a", status: "Done", sprint: S1 }),
        task({ id: "b", status: "Done" }),
        task({ id: "c", status: "Todo" }),
        task({ id: "d", status: "Cancelled" }),
      ],
    });
    expect(e!.progress).toEqual({ done: 2, total: 3 });
  });

  it("lists stories as dateless requirements, never as bars", () => {
    const [e] = buildTimelineEpics({
      epics: [
        epic({
          stories: [
            { id: "s1", title: "Login", notes: null, status: "Todo" },
            { id: "s2", title: "SSO", notes: "why", status: "Done" },
          ],
        }),
      ],
      tasks: [],
    });
    expect(e!.stories).toEqual([]);
    expect(e!.requirements).toEqual([
      { id: "s1", title: "Login", status: "Todo", incomplete: true },
      { id: "s2", title: "SSO", status: "Done", incomplete: false },
    ]);
  });
});

describe("isRequirementIncomplete", () => {
  it("is true only with no notes, success metric or acceptance criteria", () => {
    const base = { id: "s", title: "S", status: "Todo", notes: null };
    expect(isRequirementIncomplete(base)).toBe(true);
    expect(isRequirementIncomplete({ ...base, successMetric: "x" })).toBe(false);
    expect(isRequirementIncomplete({ ...base, acceptanceCriteria: "x" })).toBe(false);
    expect(isRequirementIncomplete({ ...base, notes: "x" })).toBe(false);
  });
});
