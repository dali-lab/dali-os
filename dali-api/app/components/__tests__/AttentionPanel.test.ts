import { describe, it, expect } from "vitest";
import {
  extraNotifications,
  attentionCount,
  attentionTotal,
  feedTabCounts,
  generalTaskCount,
  hasAttentionContent,
  mergedFeed,
  splitFeed,
  unloadedCounts,
  FEED_TAB_LABELS,
  type AttentionNotification,
} from "~/components/AttentionPanel";
import type { ProjectWorkItem } from "~/lib/project-work";
import type { OpenTask } from "~/components/NotificationBell";

function notif(
  over: Partial<AttentionNotification> & { id: string },
): AttentionNotification {
  return {
    kind: "General",
    title: "Something happened",
    body: null,
    link: null,
    readAt: null,
    createdAt: "2026-09-12T12:00:00.000Z",
    scheduledMeetingId: null,
    rsvp: null,
    ...over,
  };
}

const task = (id: string): OpenTask => ({ id, title: `Task ${id}`, link: null });

describe("extraNotifications", () => {
  it("drops rows that are already rendered as a task card", () => {
    const rows = extraNotifications([task("n1")], [notif({ id: "n1" }), notif({ id: "n2" })]);
    expect(rows.map((r) => r.id)).toEqual(["n2"]);
  });

  it("drops a read non-invite: its Dismiss could no longer change anything", () => {
    const rows = extraNotifications([], [notif({ id: "n1", readAt: "2026-09-12T13:00:00.000Z" })]);
    expect(rows).toEqual([]);
  });

  it("keeps a read meeting invite so its RSVP stays reachable", () => {
    const invite = notif({
      id: "n1",
      kind: "MeetingInvite",
      scheduledMeetingId: "m1",
      readAt: "2026-09-12T13:00:00.000Z",
    });
    expect(extraNotifications([], [invite]).map((r) => r.id)).toEqual(["n1"]);
  });

  it("drops an invite the user has already answered", () => {
    const answered = notif({
      id: "n1",
      kind: "MeetingInvite",
      scheduledMeetingId: "m1",
      rsvp: "Accepted",
    });
    expect(extraNotifications([], [answered])).toEqual([]);
  });
});

describe("attentionCount", () => {
  it("counts open tasks plus unread extras, not read ones", () => {
    const rows = [
      notif({ id: "unread" }),
      // Read invite: still shown for its RSVP badge, but doesn't inflate the count.
      notif({
        id: "read-invite",
        kind: "MeetingInvite",
        scheduledMeetingId: "m1",
        readAt: "2026-09-12T13:00:00.000Z",
      }),
      // Duplicate of the task card.
      notif({ id: "t1" }),
    ];
    expect(attentionCount([task("t1"), task("t2")], rows)).toBe(3);
  });

  it("is zero with nothing pending", () => {
    expect(attentionCount([], [])).toBe(0);
    expect(hasAttentionContent([], [])).toBe(false);
  });

  it("reports content when only a read invite remains", () => {
    const invite = notif({
      id: "n1",
      kind: "MeetingInvite",
      scheduledMeetingId: "m1",
      readAt: "2026-09-12T13:00:00.000Z",
    });
    expect(hasAttentionContent([], [invite])).toBe(true);
    expect(attentionCount([], [invite])).toBe(0);
  });
});

const work = (id: string): ProjectWorkItem => ({
  id,
  title: `Work ${id}`,
  projectId: "p1",
  projectName: "DALI OS",
  status: "Todo",
  dueAt: null,
  activityAt: "2026-09-12T12:00:00.000Z",
  link: `/projects/p1?tab=board&task=${id}`,
});

describe("splitFeed", () => {
  it("files Tasks-area events under work and everything else under admin", () => {
    const feed = splitFeed(
      [
        task("t1"),
        { ...task("t2"), eventType: "task.assigned", link: "/projects/p1?tab=board&task=w9" },
      ],
      [
        notif({ id: "n1", eventType: "meeting.cancelled" }),
        notif({ id: "n2", eventType: "project.sprint_closed", link: "/projects/p1" }),
      ],
      [],
    );
    expect(feed.work.map((c) => c.type)).toEqual(["task", "notification"]);
    expect(feed.admin.map((c) => c.type)).toEqual(["task", "notification"]);
  });

  it("goes by event type, not link: a form linking to a task stays admin", () => {
    const feed = splitFeed(
      [],
      [notif({ id: "n1", eventType: "form.submission", link: "/projects/p1?task=w1" })],
      [],
    );
    expect(feed.work).toEqual([]);
    expect(feed.admin).toHaveLength(1);
  });

  it("folds unread pings about a listed project task into its card", () => {
    const feed = splitFeed(
      [{ ...task("t1"), eventType: "task.due_reminder", link: "/projects/p1?tab=board&task=w1" }],
      [
        notif({ id: "n1", eventType: "task.comment", link: "/projects/p1?task=w1" }),
        notif({ id: "n2", eventType: "task.comment", link: "/projects/p1?task=w2" }),
      ],
      [work("w1")],
    );
    expect(feed.work).toHaveLength(2);
    expect(feed.work[0]).toMatchObject({ type: "project", pings: ["t1", "n1"] });
    expect(feed.work[1]).toMatchObject({ type: "notification" });
  });
});

describe("attentionCount with project work", () => {
  it("adds assigned project tasks to the badge", () => {
    expect(attentionCount([task("t1")], [], [work("w1"), work("w2")])).toBe(3);
  });

  it("doesn't count a ping folded into its project task", () => {
    const ping = { ...task("t1"), eventType: "task.due_reminder", link: "/projects/p1?task=w1" };
    expect(attentionCount([ping], [], [work("w1")])).toBe(1);
  });
});

describe("mergedFeed", () => {
  it("lists every card from both tabs, project work first", () => {
    const feed = splitFeed(
      [task("t1")],
      [notif({ id: "n1", eventType: "meeting.cancelled" })],
      [work("w1")],
    );
    const all = mergedFeed(feed);
    expect(all).toHaveLength(feed.work.length + feed.admin.length);
    expect(all.slice(0, feed.work.length)).toEqual(feed.work);
    expect(all.slice(feed.work.length)).toEqual(feed.admin);
  });

  it("is empty when both tabs are", () => {
    expect(mergedFeed(splitFeed([], [], []))).toEqual([]);
  });
});

describe("attentionTotal", () => {
  const project = (id: string): ProjectWorkItem => ({
    id,
    title: id,
    projectId: "proj",
    projectName: "Atlas",
    status: "Todo",
    dueAt: null,
    activityAt: "2026-09-12T12:00:00.000Z",
    link: "/projects/proj",
  });

  it("equals attentionCount when everything is loaded", () => {
    const tasks = [task("a"), task("b")];
    expect(attentionTotal(tasks, [], [project("p1")])).toBe(attentionCount(tasks, [], [project("p1")]));
    expect(attentionTotal(tasks, [], [project("p1")], { generalTasks: 2, projectTasks: 1 })).toBe(3);
  });

  it("adds the General and project tasks that were not loaded", () => {
    const total = attentionTotal([task("a")], [], [project("p1")], { generalTasks: 120, projectTasks: 75 });
    expect(total).toBe(2 + 119 + 74);
  });

  it("ignores a total smaller than what is loaded", () => {
    expect(attentionTotal([task("a"), task("b")], [], [], { generalTasks: 1 })).toBe(2);
  });

  it("equals the sum of the tab counts", () => {
    const tasks = [task("a"), pingFor("w1"), pingFor("gone")];
    const totals = { generalTasks: 40, projectTasks: 3 };
    const counts = feedTabCounts(splitFeed(tasks, [], [project("w1")]), unloadedCounts(tasks, [project("w1")], totals));
    expect(attentionTotal(tasks, [], [project("w1")], totals)).toBe(counts.work + counts.admin);
  });
});

const pingFor = (taskId: string): OpenTask => ({
  ...task(`ping-${taskId}`),
  eventType: "task.assigned",
  link: `/projects/p1?tab=board&task=${taskId}`,
});

describe("generalTaskCount", () => {
  it("counts tasks outside the Tasks area, including ones with no event", () => {
    expect(
      generalTaskCount([
        { eventType: "meeting.invite" },
        { eventType: null },
        { eventType: undefined },
        { eventType: "task.due_reminder" },
        { eventType: "project.sprint_closed" },
      ]),
    ).toBe(3);
  });
});

describe("unloadedCounts", () => {
  it("puts unloaded General tasks on General, not the task pings past the page", () => {
    // 77 open tasks, 50 loaded (2 of them General); 10 General in all.
    const loaded = [
      { eventType: "meeting.invite" },
      { eventType: "pagedoc.mention" },
      ...Array.from({ length: 48 }, () => ({ eventType: "task.assigned" })),
    ];
    expect(unloadedCounts(loaded, [], { generalTasks: 10 })).toEqual({ work: 0, admin: 8 });
  });

  it("adds unloaded project tasks to Project work", () => {
    expect(unloadedCounts([], [work("w1")], { projectTasks: 6 })).toEqual({ work: 5, admin: 0 });
  });

  it("is zero without server totals", () => {
    expect(unloadedCounts([{ eventType: "meeting.invite" }], [work("w1")])).toEqual({ work: 0, admin: 0 });
  });
});

describe("feedTabCounts", () => {
  it("leaves out a read invite kept only for its RSVP, like the header", () => {
    const invite = notif({
      id: "n1",
      kind: "MeetingInvite",
      scheduledMeetingId: "m1",
      readAt: "2026-09-12T13:00:00.000Z",
    });
    const feed = splitFeed([task("t1")], [invite], []);
    expect(feed.admin).toHaveLength(2);
    expect(feedTabCounts(feed)).toEqual({ work: 0, admin: 1 });
  });

  it("does not count a ping folded into its project card", () => {
    const feed = splitFeed([pingFor("w1")], [], [work("w1")]);
    expect(feedTabCounts(feed)).toEqual({ work: 1, admin: 0 });
  });

  it("adds each tab's unloaded remainder", () => {
    const feed = splitFeed([task("t1")], [], [work("w1")]);
    expect(feedTabCounts(feed, { work: 4, admin: 9 })).toEqual({ work: 5, admin: 10 });
  });
});

describe("FEED_TAB_LABELS", () => {
  it("names the non-project tab General", () => {
    expect(FEED_TAB_LABELS).toEqual({ work: "Project work", admin: "General" });
  });
});
