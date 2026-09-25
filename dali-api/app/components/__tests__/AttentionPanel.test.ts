import { describe, it, expect } from "vitest";
import {
  extraNotifications,
  attentionCount,
  hasAttentionContent,
  splitFeed,
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
