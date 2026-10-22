import { describe, expect, it } from "vitest";
import {
  applyPending,
  pendingEventId,
  pendingFromFetchers,
  type PendingSubmission,
} from "~/calendar/lib/optimistic-layer";
import type { ExternalEventDTO, TimeEntryDTO } from "~/calendar/lib/types";

const ev = (over: Partial<ExternalEventDTO> & { eventId: string }): ExternalEventDTO => ({
  startIso: "2026-10-20T14:00:00.000Z",
  endIso: "2026-10-20T15:00:00.000Z",
  title: over.eventId,
  color: null,
  ...over,
});

const entry = (over: Partial<TimeEntryDTO> & { id: string }): TimeEntryDTO => ({
  source: "Manual",
  scheduledMeetingId: null,
  occurrenceStart: null,
  sourceEventId: null,
  manualBlockId: null,
  meetingNotePageId: null,
  assignmentType: null,
  roleRefId: null,
  projectId: null,
  date: "2026-10-20T00:00:00.000Z",
  hours: 1,
  note: null,
  startTime: "2026-10-20T14:00:00.000Z",
  endTime: "2026-10-20T15:00:00.000Z",
  ...over,
});

const sub = (id: string, fields: Record<string, string>): PendingSubmission => ({ id, fields });

const base = (events: ExternalEventDTO[] = [], timeEntries: TimeEntryDTO[] = []) => ({
  externalEvents: events,
  timeEntries,
  other: "kept",
});

const formData = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("applyPending", () => {
  it("returns the same object when nothing is pending", () => {
    const data = base([ev({ eventId: "a" })]);
    expect(applyPending(data, [])).toBe(data);
  });

  it("leaves unrelated fields on the data alone", () => {
    const out = applyPending(base([ev({ eventId: "a" })]), [
      sub("1", { intent: "event-move", eventId: "a", startIso: "2026-10-21T14:00:00.000Z", endIso: "2026-10-21T15:00:00.000Z" }),
    ]);
    expect(out.other).toBe("kept");
  });

  describe("move", () => {
    it("moves the event to the dropped time", () => {
      const out = applyPending(base([ev({ eventId: "a" }), ev({ eventId: "b" })]), [
        sub("1", { intent: "event-move", eventId: "a", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T10:00:00.000Z" }),
      ]);
      expect(out.externalEvents[0]).toMatchObject({ startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T10:00:00.000Z" });
      expect(out.externalEvents[1]).toMatchObject({ startIso: "2026-10-20T14:00:00.000Z" });
    });

    it("holds two concurrent moves of different events at once", () => {
      const out = applyPending(base([ev({ eventId: "a" }), ev({ eventId: "b" })]), [
        sub("1", { intent: "event-move", eventId: "a", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T10:00:00.000Z" }),
        sub("2", { intent: "event-move", eventId: "b", startIso: "2026-10-22T09:00:00.000Z", endIso: "2026-10-22T10:00:00.000Z" }),
      ]);
      expect(out.externalEvents.map((e) => e.startIso)).toEqual([
        "2026-10-21T09:00:00.000Z",
        "2026-10-22T09:00:00.000Z",
      ]);
    });

    it("lets the latest of two moves on the same event win", () => {
      const out = applyPending(base([ev({ eventId: "a" })]), [
        sub("1", { intent: "event-move", eventId: "a", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T10:00:00.000Z" }),
        sub("2", { intent: "event-move", eventId: "a", startIso: "2026-10-23T09:00:00.000Z", endIso: "2026-10-23T10:00:00.000Z" }),
      ]);
      expect(out.externalEvents[0]!.startIso).toBe("2026-10-23T09:00:00.000Z");
    });

    it("ignores a move with no times", () => {
      const data = base([ev({ eventId: "a" })]);
      expect(applyPending(data, [sub("1", { intent: "event-move", eventId: "a" })]).externalEvents).toEqual(data.externalEvents);
    });

    it("ignores an event it does not know", () => {
      const data = base([ev({ eventId: "a" })]);
      const out = applyPending(data, [
        sub("1", { intent: "event-move", eventId: "zzz", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T10:00:00.000Z" }),
      ]);
      expect(out.externalEvents).toEqual(data.externalEvents);
    });
  });

  describe("update", () => {
    it("retitles and retimes a timed event", () => {
      const out = applyPending(base([ev({ eventId: "a" })]), [
        sub("1", { intent: "event-update", eventId: "a", title: "New", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T11:00:00.000Z", allDay: "" }),
      ]);
      expect(out.externalEvents[0]).toMatchObject({ title: "New", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T11:00:00.000Z" });
    });

    it("changes only the title of an all-day event", () => {
      const out = applyPending(base([ev({ eventId: "a", allDay: true, startIso: "2026-10-20T00:00:00.000Z", endIso: "2026-10-21T00:00:00.000Z" })]), [
        sub("1", { intent: "event-update", eventId: "a", title: "Holiday", startIso: "2026-10-22T00:00:00.000Z", endIso: "2026-10-23T00:00:00.000Z", allDay: "1" }),
      ]);
      expect(out.externalEvents[0]).toMatchObject({ title: "Holiday", startIso: "2026-10-20T00:00:00.000Z" });
    });

    it("does not retime a timed event that the form turned all-day", () => {
      const out = applyPending(base([ev({ eventId: "a" })]), [
        sub("1", { intent: "event-update", eventId: "a", title: "x", startIso: "2026-10-22T00:00:00.000Z", endIso: "2026-10-23T00:00:00.000Z", allDay: "1" }),
      ]);
      expect(out.externalEvents[0]!.startIso).toBe("2026-10-20T14:00:00.000Z");
    });

    it("keeps the old title when the form sent none", () => {
      const out = applyPending(base([ev({ eventId: "a", title: "Keep" })]), [
        sub("1", { intent: "event-update", eventId: "a", title: "", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T10:00:00.000Z" }),
      ]);
      expect(out.externalEvents[0]!.title).toBe("Keep");
    });

    it("lets an update that follows a move on the same event win", () => {
      const out = applyPending(base([ev({ eventId: "a" })]), [
        sub("1", { intent: "event-move", eventId: "a", startIso: "2026-10-21T09:00:00.000Z", endIso: "2026-10-21T10:00:00.000Z" }),
        sub("2", { intent: "event-update", eventId: "a", title: "T", startIso: "2026-10-22T09:00:00.000Z", endIso: "2026-10-22T10:00:00.000Z" }),
      ]);
      expect(out.externalEvents[0]!.startIso).toBe("2026-10-22T09:00:00.000Z");
    });
  });

  describe("meeting update", () => {
    const meeting = (id: string): ExternalEventDTO["meeting"] => ({ meetingId: id }) as ExternalEventDTO["meeting"];

    it("shifts every occurrence of the meeting and sets the duration", () => {
      const out = applyPending(
        base([
          ev({ eventId: "a", meeting: meeting("m1"), startIso: "2026-10-20T14:00:00.000Z", endIso: "2026-10-20T15:00:00.000Z" }),
          ev({ eventId: "b", meeting: meeting("m1"), startIso: "2026-10-27T14:00:00.000Z", endIso: "2026-10-27T15:00:00.000Z" }),
          ev({ eventId: "c", meeting: meeting("m2") }),
        ]),
        [sub("1", { intent: "meeting-update", meetingId: "m1", title: "Renamed", durationMinutes: "90", shiftMs: String(60 * 60_000) })],
      );
      expect(out.externalEvents[0]).toMatchObject({ title: "Renamed", startIso: "2026-10-20T15:00:00.000Z", endIso: "2026-10-20T16:30:00.000Z" });
      expect(out.externalEvents[1]).toMatchObject({ startIso: "2026-10-27T15:00:00.000Z", endIso: "2026-10-27T16:30:00.000Z" });
      expect(out.externalEvents[2]!.title).toBe("c");
    });

    it("only renames when no duration is known", () => {
      const out = applyPending(base([ev({ eventId: "a", meeting: meeting("m1") })]), [
        sub("1", { intent: "meeting-update", meetingId: "m1", title: "Renamed", durationMinutes: "0", shiftMs: "0" }),
      ]);
      expect(out.externalEvents[0]).toMatchObject({ title: "Renamed", startIso: "2026-10-20T14:00:00.000Z" });
    });
  });

  describe("delete", () => {
    const series = [
      ev({ eventId: "s_1", recurringEventId: "s", startIso: "2026-10-13T14:00:00.000Z", endIso: "2026-10-13T15:00:00.000Z" }),
      ev({ eventId: "s_2", recurringEventId: "s", startIso: "2026-10-20T14:00:00.000Z", endIso: "2026-10-20T15:00:00.000Z" }),
      ev({ eventId: "s_3", recurringEventId: "s", startIso: "2026-10-27T14:00:00.000Z", endIso: "2026-10-27T15:00:00.000Z" }),
      ev({ eventId: "other" }),
    ];

    it("hides a one-off event", () => {
      const out = applyPending(base([ev({ eventId: "a" }), ev({ eventId: "b" })]), [
        sub("1", { intent: "event-delete", eventId: "a", scope: "this", recurringEventId: "" }),
      ]);
      expect(out.externalEvents.map((e) => e.eventId)).toEqual(["b"]);
    });

    it("hides only the one occurrence for scope this", () => {
      const out = applyPending(base(series), [
        sub("1", { intent: "event-delete", eventId: "s_2", scope: "this", recurringEventId: "s", originalStartIso: "2026-10-20T14:00:00.000Z" }),
      ]);
      expect(out.externalEvents.map((e) => e.eventId)).toEqual(["s_1", "s_3", "other"]);
    });

    it("hides this and later occurrences for scope following", () => {
      const out = applyPending(base(series), [
        sub("1", { intent: "event-delete", eventId: "s_2", scope: "following", recurringEventId: "s", originalStartIso: "2026-10-20T14:00:00.000Z" }),
      ]);
      expect(out.externalEvents.map((e) => e.eventId)).toEqual(["s_1", "other"]);
    });

    it("falls back to the target instance's start when following has no original start", () => {
      const out = applyPending(base(series), [
        sub("1", { intent: "event-delete", eventId: "s_2", scope: "following", recurringEventId: "s" }),
      ]);
      expect(out.externalEvents.map((e) => e.eventId)).toEqual(["s_1", "other"]);
    });

    it("hides only the target when following cannot work out where to cut", () => {
      const out = applyPending(base(series), [
        sub("1", { intent: "event-delete", eventId: "ghost", scope: "following", recurringEventId: "s" }),
      ]);
      expect(out.externalEvents).toHaveLength(4);
    });

    it("hides the whole series for scope all, master included", () => {
      const out = applyPending(base([...series, ev({ eventId: "s" })]), [
        sub("1", { intent: "event-delete", eventId: "s_2", scope: "all", recurringEventId: "s" }),
      ]);
      expect(out.externalEvents.map((e) => e.eventId)).toEqual(["other"]);
    });

    it("hides a cancelled meeting's block", () => {
      const out = applyPending(
        base([ev({ eventId: "m", meeting: { meetingId: "m1", googleEventOrigin: "Created" } as ExternalEventDTO["meeting"] })]),
        [sub("1", { intent: "event-delete", eventId: "m", scope: "this", recurringEventId: "" })],
      );
      expect(out.externalEvents).toEqual([]);
    });

    it("keeps the block of a meeting that is only being un-tracked", () => {
      const out = applyPending(
        base([ev({ eventId: "m", meeting: { meetingId: "m1", googleEventOrigin: "Tracked" } as ExternalEventDTO["meeting"] })]),
        [sub("1", { intent: "event-delete", eventId: "m", scope: "this", recurringEventId: "" })],
      );
      expect(out.externalEvents).toHaveLength(1);
    });

    it("drops the hours logged against a deleted event", () => {
      const out = applyPending(
        base([ev({ eventId: "a" }), ev({ eventId: "b" })], [entry({ id: "t1", sourceEventId: "a" }), entry({ id: "t2", sourceEventId: "b" }), entry({ id: "t3" })]),
        [sub("1", { intent: "event-delete", eventId: "a", scope: "this", recurringEventId: "" })],
      );
      expect(out.timeEntries.map((t) => t.id)).toEqual(["t2", "t3"]);
    });
  });

  describe("rsvp", () => {
    it("sets the answer so an unanswered invite stops drawing as one", () => {
      const out = applyPending(base([ev({ eventId: "a", rsvp: "Pending" }), ev({ eventId: "b", rsvp: "Pending" })]), [
        sub("1", { intent: "event-rsvp", eventId: "a", response: "accepted" }),
      ]);
      expect(out.externalEvents.map((e) => e.rsvp)).toEqual(["Accepted", "Pending"]);
    });

    it.each([
      ["tentative", "Tentative"],
      ["declined", "Declined"],
    ])("maps %s to %s", (response, status) => {
      const out = applyPending(base([ev({ eventId: "a", rsvp: "Accepted" })]), [sub("1", { intent: "event-rsvp", eventId: "a", response })]);
      expect(out.externalEvents[0]!.rsvp).toBe(status);
    });

    it("lets the last answer win when it is changed again", () => {
      const out = applyPending(base([ev({ eventId: "a", rsvp: "Pending" })]), [
        sub("1", { intent: "event-rsvp", eventId: "a", response: "accepted" }),
        sub("2", { intent: "event-rsvp", eventId: "a", response: "declined" }),
      ]);
      expect(out.externalEvents[0]!.rsvp).toBe("Declined");
    });

    it("ignores an answer it does not recognise", () => {
      const out = applyPending(base([ev({ eventId: "a", rsvp: "Pending" })]), [sub("1", { intent: "event-rsvp", eventId: "a", response: "bogus" })]);
      expect(out.externalEvents[0]!.rsvp).toBe("Pending");
    });
  });

  describe("create", () => {
    const create = {
      intent: "event-create",
      title: "Lunch",
      startIso: "2026-10-21T16:00:00.000Z",
      endIso: "2026-10-21T17:00:00.000Z",
      destination: "link1:cal1",
      allDay: "",
    };

    it("draws a pending ghost with the calendar's colour", () => {
      const out = applyPending(base(), [sub("k", create)], { destinationColors: { "link1:cal1": "#33b679" } });
      expect(out.externalEvents).toEqual([
        expect.objectContaining({
          eventId: pendingEventId("k"),
          title: "Lunch",
          color: "#33b679",
          calendarId: "cal1",
          pending: true,
          writable: false,
          startIso: create.startIso,
        }),
      ]);
    });

    it("falls back to no colour for an unknown calendar", () => {
      expect(applyPending(base(), [sub("k", create)]).externalEvents[0]!.color).toBeNull();
    });

    it("titles an untitled ghost", () => {
      expect(applyPending(base(), [sub("k", { ...create, title: "" })]).externalEvents[0]!.title).toBe("(No title)");
    });

    it("draws one ghost for a recurring create", () => {
      const out = applyPending(base(), [sub("k", { ...create, recurrenceRule: "RRULE:FREQ=WEEKLY" })]);
      expect(out.externalEvents).toHaveLength(1);
    });

    it("draws no ghost for an all-day create", () => {
      expect(applyPending(base(), [sub("k", { ...create, allDay: "1" })]).externalEvents).toEqual([]);
    });

    it("draws no ghost without times", () => {
      expect(applyPending(base(), [sub("k", { ...create, startIso: "" })]).externalEvents).toEqual([]);
    });

    it("draws a ghost for a meeting that is being created", () => {
      const out = applyPending(base(), [sub("k", { intent: "meeting-create", title: "Sync", startIso: create.startIso, endIso: create.endIso })]);
      expect(out.externalEvents[0]).toMatchObject({ title: "Sync", pending: true });
    });

    it("gives two creates distinct ghosts", () => {
      const out = applyPending(base(), [sub("a", create), sub("b", create)]);
      expect(new Set(out.externalEvents.map((e) => e.eventId)).size).toBe(2);
    });
  });

  describe("time entries", () => {
    const add = {
      intent: "add-time-entry",
      startTime: "2026-10-21T13:00:00.000Z",
      endTime: "2026-10-21T15:00:00.000Z",
      date: "2026-10-21",
      hours: "2",
      assignmentType: "Project",
      roleRefId: "r1",
      note: "Worked",
    };

    it("draws a ghost entry for an add", () => {
      const out = applyPending(base(), [sub("k", add)]);
      expect(out.timeEntries).toEqual([
        expect.objectContaining({
          id: pendingEventId("k"),
          source: "Manual",
          hours: 2,
          note: "Worked",
          assignmentType: "Project",
          roleRefId: "r1",
          startTime: add.startTime,
          endTime: add.endTime,
          date: "2026-10-21T00:00:00.000Z",
        }),
      ]);
    });

    it("draws no ghost for an entry logged against a meeting", () => {
      expect(applyPending(base(), [sub("k", { ...add, scheduledMeetingId: "m1" })]).timeEntries).toEqual([]);
    });

    it("draws no ghost for an add with no time range", () => {
      expect(applyPending(base(), [sub("k", { ...add, startTime: "" })]).timeEntries).toEqual([]);
    });

    it("patches an entry by id on update", () => {
      const out = applyPending(base([], [entry({ id: "t1", note: "old" }), entry({ id: "t2", note: "other" })]), [
        sub("1", { intent: "update-time-entry", id: "t1", startTime: add.startTime, endTime: add.endTime, date: "2026-10-21", hours: "2", assignmentType: "Project", roleRefId: "r9", note: "new" }),
      ]);
      expect(out.timeEntries[0]).toMatchObject({ note: "new", hours: 2, roleRefId: "r9", startTime: add.startTime, date: "2026-10-21T00:00:00.000Z" });
      expect(out.timeEntries[1]!.note).toBe("other");
    });

    it("keeps the role when an update sends none, and clears an emptied note", () => {
      const out = applyPending(base([], [entry({ id: "t1", note: "old", assignmentType: "Project", roleRefId: "r1" })]), [
        sub("1", { intent: "update-time-entry", id: "t1", assignmentType: "", roleRefId: "", note: "" }),
      ]);
      expect(out.timeEntries[0]).toMatchObject({ note: null, assignmentType: "Project", roleRefId: "r1" });
    });

    it("removes an entry on delete", () => {
      const out = applyPending(base([], [entry({ id: "t1" }), entry({ id: "t2" })]), [sub("1", { intent: "delete-time-entry", id: "t1" })]);
      expect(out.timeEntries.map((t) => t.id)).toEqual(["t2"]);
    });
  });

  it("ignores an intent it does not draw", () => {
    const data = base([ev({ eventId: "a" })]);
    expect(applyPending(data, [sub("1", { intent: "cal-rename", eventId: "a" })]).externalEvents).toEqual(data.externalEvents);
  });
});

describe("pendingFromFetchers", () => {
  const fetcher = (over: Partial<Parameters<typeof pendingFromFetchers>[0][number]> & { key: string }) => ({
    state: "loading",
    ...over,
  });

  it("keeps in-flight fetchers with a known intent", () => {
    const out = pendingFromFetchers([
      fetcher({ key: "k1", state: "submitting", formData: formData({ intent: "event-move", eventId: "a" }) }),
      fetcher({ key: "k2", state: "loading", formData: formData({ intent: "event-delete", eventId: "b" }) }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["k1", "k2"]);
    expect(out[0]!.fields).toEqual({ intent: "event-move", eventId: "a" });
  });

  it("drops an idle fetcher: its form data is gone and fresh data has landed", () => {
    expect(pendingFromFetchers([fetcher({ key: "k", state: "idle" })])).toEqual([]);
    expect(pendingFromFetchers([fetcher({ key: "k", state: "idle", formData: formData({ intent: "event-move" }) })])).toEqual([]);
  });

  it("contributes nothing when the action answered with an error", () => {
    const out = pendingFromFetchers([
      fetcher({ key: "k", formData: formData({ intent: "event-move", eventId: "a" }), data: { error: "Room taken" } }),
    ]);
    expect(out).toEqual([]);
  });

  it("still draws a submission whose action answered without an error", () => {
    const out = pendingFromFetchers([
      fetcher({ key: "k1", formData: formData({ intent: "add-time-entry" }), data: { ok: true } }),
      fetcher({ key: "k2", formData: formData({ intent: "event-move" }), data: null }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["k1", "k2"]);
  });

  it("skips intents the grid does not draw", () => {
    expect(pendingFromFetchers([fetcher({ key: "k", formData: formData({ intent: "cal-rename" }) })])).toEqual([]);
    expect(pendingFromFetchers([fetcher({ key: "k", formData: formData({}) })])).toEqual([]);
  });

  it("orders by when each submission was first seen, not by fetcher key", () => {
    const first = fetcher({ key: "z", formData: formData({ intent: "event-move", eventId: "a", n: "1" }) });
    const second = fetcher({ key: "a", formData: formData({ intent: "event-move", eventId: "a", n: "2" }) });
    pendingFromFetchers([first]);
    const out = pendingFromFetchers([second, first]);
    expect(out.map((p) => p.fields.n)).toEqual(["1", "2"]);
  });

  it("keeps a later submission on a reused key after an earlier one on another", () => {
    const a = fetcher({ key: "k1", formData: formData({ intent: "event-move", n: "a" }) });
    pendingFromFetchers([a]);
    const b1 = fetcher({ key: "k2", formData: formData({ intent: "event-move", n: "b" }) });
    pendingFromFetchers([a, b1]);
    const a2 = fetcher({ key: "k1", formData: formData({ intent: "event-move", n: "a2" }) });
    const out = pendingFromFetchers([a2, b1]);
    expect(out.map((p) => p.fields.n)).toEqual(["b", "a2"]);
  });
});
