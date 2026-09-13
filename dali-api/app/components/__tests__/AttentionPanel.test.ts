import { describe, it, expect } from "vitest";
import {
  extraNotifications,
  attentionCount,
  hasAttentionContent,
  type AttentionNotification,
} from "~/components/AttentionPanel";
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
