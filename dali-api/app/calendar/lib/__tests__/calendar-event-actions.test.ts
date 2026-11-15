import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: () => new Response("forbidden", { status: 403 }),
  redirectNonMemberToPortal: vi.fn(),
  isImpersonating: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  isLabMember: vi.fn(),
  canViewForms: vi.fn(),
  isCore: vi.fn(),
  currentTerm: vi.fn(),
  currentTermMemberWhere: vi.fn(),
  getUserRoleInstances: vi.fn(),
  resolveRoleRef: vi.fn(),
}));
vi.mock("~/calendar/lib/external-cache.server", () => ({
  cachedExternalRead: vi.fn(),
  invalidateExternalCache: vi.fn(),
  markCalendarChanged: vi.fn(async () => {}),
}));
vi.mock("~/calendar/lib/sub-calendar.server", () => ({ setSubCalendarEnabled: vi.fn() }));
vi.mock("~/lib/groups.server", () => ({ listAllGroups: vi.fn() }));
vi.mock("~/mentorship/lib/pair-suggestion.server", () => ({ listMentorPairs: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/member-class.server", () => {
  class MemberClassError extends Error {}
  return {
    createClass: vi.fn(),
    updateClass: vi.fn(),
    removeClass: vi.fn(),
    refreshClass: vi.fn(),
    parseDestination: vi.fn((raw: string) => ({ parsed: raw })),
    toMemberClassDTO: vi.fn(),
    buildClassDestinations: vi.fn(),
    MemberClassError,
  };
});
vi.mock("~/calendar/lib/time-entries.server", () => ({
  addTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  timeEntryResult: vi.fn(),
}));
vi.mock("~/calendar/lib/timesheet-mirror.server", () => ({
  setUserTimesheetSync: vi.fn(),
  removeTimeEntryFromGoogle: vi.fn(),
}));
vi.mock("~/calendar/lib/google-calendar.server", () => ({
  fetchCalendarEvents: vi.fn(),
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
  createCalendar: vi.fn(),
  patchCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  getValidAccessTokenForLink: vi.fn(),
  listCalendarsForLink: vi.fn(),
  subscribeCalendarForLink: vi.fn(),
  respondToGoogleEventAsSelf: vi.fn(),
  NotAGuestError: class NotAGuestError extends Error {},
}));
vi.mock("~/calendar/lib/general-calendar", () => ({
  generalCalendarId: vi.fn(),
  isGeneralCalendarEvent: vi.fn(),
  generalCalendarState: vi.fn(),
}));
vi.mock("~/lib/notify-stream.server", () => ({ publishNotificationChange: vi.fn() }));
vi.mock("~/calendar/lib/scheduled-meeting.server", () => ({
  cancelScheduledMeeting: vi.fn(),
  trackExternalEventAsMeeting: vi.fn(),
  updateScheduledMeeting: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-artifacts.server", () => ({
  attachMeetingNote: vi.fn(),
  attachMeetingWhiteboard: vi.fn(),
  setMeetingProject: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-roster.server", () => ({
  resolveMeetingOccurrence: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-occurrences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/calendar/lib/meeting-occurrences")>()),
  ownsGoogleEvent: vi.fn(),
  parseOccurrenceParam: vi.fn((v: unknown) => (v ? { parsed: v } : undefined)),
}));
vi.mock("~/lib/note-path.server", () => ({ meetingNotePath: vi.fn() }));
vi.mock("~/rooms/lib/rooms.server", () => ({
  bookRoomsForEvent: vi.fn(),
  claimEventRoomBookings: vi.fn(),
  releaseEventRoomBookings: vi.fn(),
  releaseRoomBookings: vi.fn(),
  retimeEventRoomBookings: vi.fn(),
  truncateEventRoomBookings: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-link.server", () => ({ meetingLinkRedirect: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { resolveRoleRef } from "~/lib/roles";
import {
  createGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleEvent,
  respondToGoogleEventAsSelf,
  NotAGuestError,
} from "~/calendar/lib/google-calendar.server";
import { publishNotificationChange } from "~/lib/notify-stream.server";
import {
  cancelScheduledMeeting,
  updateScheduledMeeting,
} from "~/calendar/lib/scheduled-meeting.server";
import {
  bookRoomsForEvent,
  claimEventRoomBookings,
  releaseEventRoomBookings,
  releaseRoomBookings,
  retimeEventRoomBookings,
  truncateEventRoomBookings,
} from "~/rooms/lib/rooms.server";
import { submitCalendarAction } from "~/calendar/lib/calendar-actions.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const START = "2026-11-09T14:00:00.000Z";
const END = "2026-11-09T15:30:00.000Z";

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return submitCalendarAction(new Request("http://localhost/calendar", { method: "POST", body }));
}

const base = { destination: "l1:cal1", startIso: START, endIso: END, title: "  Office hours  " };
const SERIES = ["RRULE:FREQ=WEEKLY;COUNT=10"];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", type: "member" } } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.userCalendarLink!.findFirst!.mockResolvedValue({ id: "l1" });
  db.scheduledMeeting!.findFirst!.mockResolvedValue(null);
  db.roomBooking = { findMany: vi.fn(async () => []) };
  db.timeEntry!.deleteMany!.mockResolvedValue({ count: 0 });
  db.timeEntry!.updateMany!.mockResolvedValue({ count: 0 });
  vi.mocked(retimeEventRoomBookings).mockResolvedValue({ ok: true } as never);
  vi.mocked(bookRoomsForEvent).mockResolvedValue({ ok: true, value: ["b1"] } as never);
  vi.mocked(truncateEventRoomBookings).mockResolvedValue({ ok: true } as never);
  vi.mocked(createGoogleCalendarEvent).mockResolvedValue({ eventId: "new-ev" } as never);
  vi.mocked(getGoogleEvent).mockResolvedValue({ recurrence: SERIES } as never);
  vi.mocked(updateScheduledMeeting).mockResolvedValue({ ok: true, meeting: {}, gcalError: null } as never);
  vi.mocked(cancelScheduledMeeting).mockResolvedValue({ ok: true } as never);
  vi.mocked(resolveRoleRef).mockResolvedValue({ projectId: "p1" } as never);
});

describe("event-* gating", () => {
  it("needs a calendar to write to", async () => {
    const res = await post({ ...base, intent: "event-create", destination: "" });

    expect(res!.status).toBe(400);
    expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("will not write to a calendar link the user does not own", async () => {
    db.userCalendarLink!.findFirst!.mockResolvedValue(null);

    const res = await post({ ...base, intent: "event-create" });

    expect(res!.status).toBe(500);
    expect((await res!.json()).error).toMatch(/isn't connected/);
    expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(db.userCalendarLink!.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "l1", userId: "u1", provider: "Google" } }),
    );
  });

  it("hides a Google failure behind a generic message", async () => {
    vi.mocked(createGoogleCalendarEvent).mockRejectedValue(new Error("secret token detail"));

    const res = await post({ ...base, intent: "event-create" });

    expect(res!.status).toBe(500);
    expect(await res!.json()).toEqual({ error: "Couldn't save to Google Calendar." });
  });

  it("needs a start and end", async () => {
    expect((await post({ ...base, intent: "event-create", endIso: "" }))!.status).toBe(400);
  });

  it("needs a title for create and update but not for a move or delete", async () => {
    expect((await post({ ...base, intent: "event-create", title: " " }))!.status).toBe(400);
    expect((await post({ ...base, intent: "event-update", eventId: "e1", title: " " }))!.status).toBe(400);
    expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();

    expect(await post({ ...base, intent: "event-move", eventId: "e1", title: "" })).toBeNull();
  });

  it("rejects an unknown event action", async () => {
    expect((await post({ ...base, intent: "event-wat" }))!.status).toBe(400);
  });
});

describe("event-rsvp", () => {
  const rsvp = { intent: "event-rsvp", destination: "l1:cal1", eventId: "e1", response: "accepted" };

  it("needs an event id and a known response", async () => {
    expect((await post({ ...rsvp, eventId: "" }))!.status).toBe(400);
    expect((await post({ ...rsvp, response: "maybe" }))!.status).toBe(400);
    expect(respondToGoogleEventAsSelf).not.toHaveBeenCalled();
  });

  it("answers 400 with Google's message when the user is not a guest", async () => {
    vi.mocked(respondToGoogleEventAsSelf).mockRejectedValue(new (NotAGuestError as unknown as new (m: string) => Error)("You are not a guest"));

    const res = await post(rsvp);

    expect(res!.status).toBe(400);
    expect(await res!.json()).toEqual({ error: "You are not a guest" });
  });

  it("brings the matching invite notification along, looking up by the series master for an instance", async () => {
    db.scheduledMeeting!.findFirst!.mockResolvedValue({ id: "m1" });
    db.notification!.updateMany!.mockResolvedValue({ count: 1 });

    await post({ ...rsvp, eventId: "master_20261109T140000Z", recurringEventId: "master", response: "tentative" });

    expect(db.scheduledMeeting!.findFirst).toHaveBeenCalledWith({
      where: { externalEventId: { in: ["master_20261109T140000Z", "master"] } },
      select: { id: true },
    });
    expect(db.notification!.updateMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", recipientUserId: "u1" },
      data: { rsvp: "Tentative", rsvpAt: expect.any(Date), readAt: expect.any(Date) },
    });
    expect(publishNotificationChange).toHaveBeenCalledWith(["u1"]);
  });

  it("does not poke the desktop badge when no notification changed", async () => {
    db.scheduledMeeting!.findFirst!.mockResolvedValue({ id: "m1" });
    db.notification!.updateMany!.mockResolvedValue({ count: 0 });

    await post(rsvp);

    expect(publishNotificationChange).not.toHaveBeenCalled();
  });
});

describe("event-delete", () => {
  const del = { intent: "event-delete", destination: "l1:cal1", eventId: "e1" };

  it("deletes a plain event, its linked hours and its room hold", async () => {
    expect(await post(del)).toBeNull();

    expect(deleteGoogleCalendarEvent).toHaveBeenCalledWith({ linkId: "l1", calendarId: "cal1", eventId: "e1" });
    expect(db.timeEntry!.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", sourceEventId: "e1" } });
    expect(releaseEventRoomBookings).toHaveBeenCalledWith("u1", "e1", { scope: "all", occurrenceStart: undefined });
  });

  it("needs an event id", async () => {
    const res = await post({ ...del, eventId: "" });

    expect(res!.status).toBe(400);
    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("deletes the whole series master for scope all, releasing the hold keyed by the master", async () => {
    await post({ ...del, eventId: "master_20261109T140000Z", recurringEventId: "master", scope: "all" });

    expect(deleteGoogleCalendarEvent).toHaveBeenCalledWith({ linkId: "l1", calendarId: "cal1", eventId: "master" });
    expect(releaseEventRoomBookings).toHaveBeenCalledWith("u1", "master", {
      scope: "all",
      occurrenceStart: new Date("2026-11-09T14:00:00.000Z"),
    });
  });

  it("deletes one occurrence of a series for scope this", async () => {
    await post({ ...del, eventId: "master_20261109T140000Z", recurringEventId: "master", scope: "this" });

    expect(deleteGoogleCalendarEvent).toHaveBeenCalledWith({
      linkId: "l1",
      calendarId: "cal1",
      eventId: "master_20261109T140000Z",
    });
    expect(releaseEventRoomBookings).toHaveBeenCalledWith("u1", "master", {
      scope: "this",
      occurrenceStart: new Date("2026-11-09T14:00:00.000Z"),
    });
  });

  it("ends the series one second before the occurrence for scope following, without deleting", async () => {
    await post({
      ...del,
      eventId: "master_20261109T140000Z",
      recurringEventId: "master",
      scope: "following",
      originalStartIso: START,
    });

    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(patchGoogleCalendarEvent).toHaveBeenCalledWith({
      linkId: "l1",
      calendarId: "cal1",
      eventId: "master",
      recurrenceRule: "FREQ=WEEKLY;UNTIL=20261109T135959Z",
    });
  });

  describe("when the event is a DALI meeting", () => {
    beforeEach(() => {
      db.scheduledMeeting!.findFirst!.mockResolvedValue({ id: "m1" });
    });

    it("cancels it through DALI as the user (allowing Core) instead of deleting from Google directly", async () => {
      const res = await post({
        ...del,
        eventId: "master_20261109T140000Z",
        recurringEventId: "master",
        scope: "following",
        originalStartIso: START,
      });

      expect(res).toBeNull();
      expect(db.scheduledMeeting!.findFirst).toHaveBeenCalledWith({
        where: { externalEventId: { in: ["master_20261109T140000Z", "master"] }, status: { not: "Cancelled" } },
        select: { id: true },
      });
      expect(cancelScheduledMeeting).toHaveBeenCalledWith("m1", "u1", {
        allowCore: true,
        scope: "following",
        occurrenceStart: START,
        occurrenceEventId: "master_20261109T140000Z",
      });
      expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
    });

    it("defaults to cancelling the whole meeting", async () => {
      await post(del);

      expect(vi.mocked(cancelScheduledMeeting).mock.calls[0]![2]).toMatchObject({ scope: "all", occurrenceStart: undefined });
    });

    it("returns the cancel refusal, e.g. for someone who is not the organizer", async () => {
      vi.mocked(cancelScheduledMeeting).mockResolvedValue({ ok: false, error: "Only the organizer", status: 403 } as never);

      const res = await post(del);

      expect(res!.status).toBe(403);
      expect(await res!.json()).toEqual({ error: "Only the organizer" });
    });

    it("works without any calendar destination", async () => {
      expect(await post({ intent: "event-delete", eventId: "e1" })).toBeNull();
      expect(cancelScheduledMeeting).toHaveBeenCalled();
    });
  });
});

describe("event-move", () => {
  const move = { intent: "event-move", destination: "l1:cal1", eventId: "e1", startIso: START, endIso: END };

  it("needs an event id", async () => {
    expect((await post({ ...move, eventId: "" }))!.status).toBe(400);
  });

  it("retimes the room hold, patches Google, and moves the linked hours", async () => {
    expect(await post(move)).toBeNull();

    expect(retimeEventRoomBookings).toHaveBeenCalledWith({
      userId: "u1",
      sourceEventId: "e1",
      start: new Date(START),
      end: new Date(END),
      scope: "all",
      occurrenceStart: undefined,
    });
    expect(patchGoogleCalendarEvent).toHaveBeenCalledWith({
      linkId: "l1",
      calendarId: "cal1",
      eventId: "e1",
      startIso: START,
      endIso: END,
      allDay: false,
      timeZone: undefined,
    });
    expect(db.timeEntry!.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", sourceEventId: "e1" },
      data: { date: new Date(START), startTime: new Date(START), endTime: new Date(END), hours: 1.5 },
    });
  });

  it("moves one occurrence's hold, keyed by the series master", async () => {
    await post({ ...move, eventId: "master_20261102T140000Z", recurringEventId: "master" });

    expect(retimeEventRoomBookings).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: "master",
        scope: "this",
        occurrenceStart: new Date("2026-11-02T14:00:00.000Z"),
      }),
    );
  });

  it("rejects the move before Google is touched when a room is taken", async () => {
    vi.mocked(retimeEventRoomBookings).mockResolvedValue({ ok: false, error: "Room busy", status: 409 } as never);

    const res = await post(move);

    expect(res!.status).toBe(409);
    expect(await res!.json()).toEqual({ error: "Room busy" });
    expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(db.timeEntry!.updateMany).not.toHaveBeenCalled();
  });

  it("passes the all-day flag and time zone to the raw Google patch and skips the meeting path", async () => {
    await post({ ...move, allDay: "1", timeZone: "America/New_York" });

    expect(db.scheduledMeeting!.findFirst).not.toHaveBeenCalled();
    expect(patchGoogleCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, timeZone: "America/New_York" }),
    );
  });
});

describe("event-create", () => {
  const create = { ...base, intent: "event-create" };

  it("creates the event with trimmed fields and no guests", async () => {
    const res = await post({
      ...create,
      description: " Bring laptops ",
      location: " Rm 1 ",
      timeZone: "America/New_York",
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
    });

    expect(res).toBeNull();
    expect(createGoogleCalendarEvent).toHaveBeenCalledWith({
      linkId: "l1",
      calendarId: "cal1",
      summary: "Office hours",
      description: "Bring laptops",
      location: "Rm 1",
      startIso: START,
      endIso: END,
      allDay: false,
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
      timeZone: "America/New_York",
      attendees: [],
    });
    expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
  });

  it("sends empty description and location as undefined and an empty rule as null", async () => {
    await post(create);

    expect(vi.mocked(createGoogleCalendarEvent).mock.calls[0]![0]).toMatchObject({
      description: undefined,
      location: undefined,
      recurrenceRule: null,
      calendarId: "cal1",
    });
  });

  describe("rooms", () => {
    it("books each distinct room before Google and claims the holds for the new event afterwards", async () => {
      const order: string[] = [];
      vi.mocked(bookRoomsForEvent).mockImplementation((async () => {
        order.push("book");
        return { ok: true, value: ["b1", "b2"] };
      }) as never);
      vi.mocked(createGoogleCalendarEvent).mockImplementation((async () => {
        order.push("google");
        return { eventId: "new-ev" };
      }) as never);

      await post({ ...create, roomIds: "r1,r2,r1,", recurrenceRule: "FREQ=WEEKLY" });

      expect(order).toEqual(["book", "google"]);
      expect(bookRoomsForEvent).toHaveBeenCalledWith({
        roomIds: ["r1", "r2"],
        userId: "u1",
        start: new Date(START),
        end: new Date(END),
        title: "Office hours",
        recurrenceRule: "FREQ=WEEKLY",
      });
      expect(claimEventRoomBookings).toHaveBeenCalledWith(["b1", "b2"], "new-ev");
    });

    it("rejects the save, creating nothing in Google, when a room is taken", async () => {
      vi.mocked(bookRoomsForEvent).mockResolvedValue({ ok: false, error: "Room busy", status: 409 } as never);

      const res = await post({ ...create, roomIds: "r1" });

      expect(res!.status).toBe(409);
      expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    });

    it("refuses a room on an all-day event", async () => {
      const res = await post({ ...create, roomIds: "r1", allDay: "1" });

      expect(res!.status).toBe(400);
      expect(bookRoomsForEvent).not.toHaveBeenCalled();
    });

    it("gives the rooms back if Google then fails", async () => {
      vi.mocked(createGoogleCalendarEvent).mockRejectedValue(new Error("down"));

      const res = await post({ ...create, roomIds: "r1" });

      expect(res!.status).toBe(500);
      expect(releaseRoomBookings).toHaveBeenCalledWith(["b1"]);
      expect(claimEventRoomBookings).not.toHaveBeenCalled();
    });
  });

  describe("count this as work", () => {
    const work = { ...create, isWork: "1", assignmentType: "Project", roleRefId: "r9", workNote: " Prep " };

    it("logs the event's hours against the chosen role, keyed by the new event and user", async () => {
      expect(await post(work)).toBeNull();

      expect(resolveRoleRef).toHaveBeenCalledWith("u1", "Project", "r9");
      expect(db.timeEntry!.upsert).toHaveBeenCalledWith({
        where: { sourceEventId_userId: { sourceEventId: "new-ev", userId: "u1" } },
        create: expect.objectContaining({
          userId: "u1",
          source: "Manual",
          sourceEventId: "new-ev",
          hours: 1.5,
          date: new Date(START),
          startTime: new Date(START),
          endTime: new Date(END),
          assignmentType: "Project",
          roleRefId: "r9",
          projectId: "p1",
          note: "Prep",
          sourceCalendarLinkId: "l1",
        }),
        update: expect.objectContaining({ hours: 1.5, note: "Prep" }),
      });
    });

    it("falls back to the event title as the note", async () => {
      await post({ ...work, workNote: "" });

      expect(db.timeEntry!.upsert!.mock.calls[0]![0].create.note).toBe("Office hours");
    });

    it("needs a role", async () => {
      const res = await post({ ...create, isWork: "1" });

      expect(res!.status).toBe(400);
      expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    });

    it("refuses a role that is not the user's, before touching Google", async () => {
      vi.mocked(resolveRoleRef).mockResolvedValue(null as never);

      const res = await post(work);

      expect(res!.status).toBe(400);
      expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    });

    it("refuses work on a repeating or all-day event", async () => {
      expect((await post({ ...work, recurrenceRule: "FREQ=DAILY" }))!.status).toBe(400);
      expect((await post({ ...work, allDay: "1" }))!.status).toBe(400);
      expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    });

    it("leaves existing hours alone when the fields are absent, and clears them only on clearWork", async () => {
      await post({ ...create, eventId: "ignored" });
      expect(db.timeEntry!.deleteMany).not.toHaveBeenCalled();

      await post({ ...create, clearWork: "1" });
      expect(db.timeEntry!.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", sourceEventId: "new-ev" } });
    });
  });
});

describe("event-update", () => {
  const update = { ...base, intent: "event-update", eventId: "e1", description: "d", location: "l" };
  const fields = { summary: "Office hours", description: "d", location: "l", allDay: false, timeZone: undefined };

  it("needs an event id", async () => {
    expect((await post({ ...update, eventId: "" }))!.status).toBe(400);
  });

  it("retimes a plain event's hold, patches Google, and keeps the work log in step", async () => {
    expect(await post({ ...update, isWork: "1", assignmentType: "Project", roleRefId: "r9" })).toBeNull();

    expect(retimeEventRoomBookings).toHaveBeenCalledWith({
      userId: "u1",
      sourceEventId: "e1",
      start: new Date(START),
      end: new Date(END),
      scope: "all",
      occurrenceStart: undefined,
    });
    expect(patchGoogleCalendarEvent).toHaveBeenCalledWith({
      linkId: "l1",
      calendarId: "cal1",
      eventId: "e1",
      startIso: START,
      endIso: END,
      ...fields,
    });
    expect(db.timeEntry!.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceEventId_userId: { sourceEventId: "e1", userId: "u1" } } }),
    );
  });

  it("adds a Meet link only when asked", async () => {
    await post(update);
    expect(patchGoogleCalendarEvent).toHaveBeenLastCalledWith(expect.not.objectContaining({ addMeet: true }));

    await post({ ...update, addMeet: "1" });
    expect(patchGoogleCalendarEvent).toHaveBeenLastCalledWith(expect.objectContaining({ addMeet: true }));
  });

  it("blocks the edit, leaving Google alone, when the room is taken", async () => {
    vi.mocked(retimeEventRoomBookings).mockResolvedValue({ ok: false, error: "Room busy", status: 409 } as never);

    expect((await post(update))!.status).toBe(409);
    expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("validates the work half before touching Google", async () => {
    vi.mocked(resolveRoleRef).mockResolvedValue(null as never);

    expect((await post({ ...update, isWork: "1", assignmentType: "Project", roleRefId: "r9" }))!.status).toBe(400);
    expect((await post({ ...update, isWork: "1", assignmentType: "Project", roleRefId: "r9", allDay: "1" }))!.status).toBe(400);
    expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  describe("recurring", () => {
    const series = { ...update, eventId: "master_20261109T140000Z", recurringEventId: "master" };

    it("scope all patches the master and resizes the series' holds", async () => {
      await post({ ...series, scope: "all" });

      expect(retimeEventRoomBookings).toHaveBeenCalledWith({
        userId: "u1",
        sourceEventId: "master",
        start: new Date(START),
        end: new Date(END),
        scope: "all",
      });
      expect(patchGoogleCalendarEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "master", startIso: START, endIso: END }),
      );
      expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
    });

    it("scope all stops before Google when a room is taken", async () => {
      vi.mocked(retimeEventRoomBookings).mockResolvedValue({ ok: false, error: "Room busy", status: 409 } as never);

      expect((await post({ ...series, scope: "all" }))!.status).toBe(409);
      expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();
    });

    it("scope this patches just the instance and retimes only that occurrence's hold", async () => {
      await post({ ...series, scope: "this" });

      expect(retimeEventRoomBookings).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceEventId: "master",
          scope: "this",
          occurrenceStart: new Date("2026-11-09T14:00:00.000Z"),
        }),
      );
      expect(patchGoogleCalendarEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "master_20261109T140000Z" }),
      );
    });

    it("scope following truncates the master a second before, then starts a new series with the edited fields", async () => {
      vi.mocked(getGoogleEvent).mockResolvedValue({
        recurrence: SERIES,
        startIso: "2026-11-02T14:00:00.000Z",
      } as never);
      await post({ ...series, scope: "following", originalStartIso: START, addMeet: "1" });

      expect(patchGoogleCalendarEvent).toHaveBeenCalledWith({
        linkId: "l1",
        calendarId: "cal1",
        eventId: "master",
        recurrenceRule: "FREQ=WEEKLY;UNTIL=20261109T135959Z",
      });
      expect(createGoogleCalendarEvent).toHaveBeenCalledWith({
        linkId: "l1",
        calendarId: "cal1",
        summary: "Office hours",
        description: "d",
        location: "l",
        startIso: START,
        endIso: END,
        allDay: false,
        recurrenceRule: "FREQ=WEEKLY;COUNT=9",
        timeZone: undefined,
        attendees: [],
        addMeet: true,
      });
      expect(truncateEventRoomBookings).not.toHaveBeenCalled();
      expect(bookRoomsForEvent).not.toHaveBeenCalled();
    });

    it("scope following splits live room holds: truncate first, then rebook with the old series' end", async () => {
      const order: string[] = [];
      const seriesEnd = new Date("2026-12-14T14:00:00.000Z");
      db.roomBooking = { findMany: vi.fn(async () => [
        { roomId: "r1", seriesEnd },
        { roomId: "r2", seriesEnd: new Date("2026-12-07T14:00:00.000Z") },
        { roomId: "r1", seriesEnd: null },
      ]) };
      vi.mocked(truncateEventRoomBookings).mockImplementation((async () => {
        order.push("truncate");
        return { ok: true };
      }) as never);
      vi.mocked(bookRoomsForEvent).mockImplementation((async () => {
        order.push("book");
        return { ok: true, value: ["nb1"] };
      }) as never);

      await post({ ...series, scope: "following", originalStartIso: START });

      expect(order).toEqual(["truncate", "book"]);
      expect(truncateEventRoomBookings).toHaveBeenCalledWith("u1", "master", new Date("2026-11-09T14:00:00.000Z"));
      expect(bookRoomsForEvent).toHaveBeenCalledWith({
        roomIds: ["r1", "r2"],
        userId: "u1",
        start: new Date(START),
        end: new Date(END),
        title: "Office hours",
        recurrenceRule: "FREQ=WEEKLY;UNTIL=20261214T140000Z",
      });
      expect(claimEventRoomBookings).toHaveBeenCalledWith(["nb1"], "new-ev");
    });

    it("scope following with a taken room stops before Google is changed", async () => {
      db.roomBooking = { findMany: vi.fn(async () => [{ roomId: "r1", seriesEnd: null }]) };
      vi.mocked(bookRoomsForEvent).mockResolvedValue({ ok: false, error: "Room busy", status: 409 } as never);

      expect((await post({ ...series, scope: "following", originalStartIso: START }))!.status).toBe(409);
      expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();
      expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    });

    it("scope following surfaces a failed truncate of the holds", async () => {
      db.roomBooking = { findMany: vi.fn(async () => [{ roomId: "r1", seriesEnd: null }]) };
      vi.mocked(truncateEventRoomBookings).mockResolvedValue({ ok: false, error: "Nope", status: 422 } as never);

      expect((await post({ ...series, scope: "following", originalStartIso: START }))!.status).toBe(422);
      expect(bookRoomsForEvent).not.toHaveBeenCalled();
    });

    it("scope following releases the new holds if Google then fails to create the series", async () => {
      db.roomBooking = { findMany: vi.fn(async () => [{ roomId: "r1", seriesEnd: null }]) };
      vi.mocked(createGoogleCalendarEvent).mockRejectedValue(new Error("down"));

      const res = await post({ ...series, scope: "following", originalStartIso: START });

      expect(res!.status).toBe(500);
      expect(releaseRoomBookings).toHaveBeenCalledWith(["b1"]);
    });
  });
});

describe("event-update on a DALI meeting (composer)", () => {
  const edit = {
    intent: "event-update",
    destination: "l1:cal1",
    eventId: "ev1",
    title: "  Weekly sync ",
    startIso: START,
    endIso: END,
    location: " Rm 2 ",
    description: " Notes ",
  };

  beforeEach(() => {
    db.scheduledMeeting!.findFirst!.mockResolvedValue({ id: "m1", recurrenceRule: "FREQ=WEEKLY" });
  });

  it("finds the meeting by the event or its series master", async () => {
    await post({ ...edit, recurringEventId: "master" });

    expect(db.scheduledMeeting!.findFirst).toHaveBeenCalledWith({
      where: { externalEventId: { in: ["ev1", "master"] }, status: { not: "Cancelled" } },
      select: { id: true, recurrenceRule: true },
    });
  });

  it("edits through updateScheduledMeeting as the user, keeping the stored recurrence for scope all", async () => {
    expect(await post(edit)).toBeNull();

    expect(updateScheduledMeeting).toHaveBeenCalledWith("m1", "u1", {
      title: "Weekly sync",
      durationMinutes: 90,
      scope: { type: "None" },
      startTime: START,
      recurrenceRule: "FREQ=WEEKLY",
      location: "Rm 2",
      description: "Notes",
      guestEmails: undefined,
      editScope: "all",
      occurrenceStart: undefined,
      occurrenceEventId: "ev1",
    });
    expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("leaves the recurrence to the update for this/following edits and passes the occurrence", async () => {
    await post({ ...edit, scope: "this", originalStartIso: START, recurringEventId: "master" });

    expect(updateScheduledMeeting).toHaveBeenCalledWith(
      "m1",
      "u1",
      expect.objectContaining({ recurrenceRule: undefined, editScope: "this", occurrenceStart: START }),
    );
  });

  it("normalises the guest scope from the wire and drops junk", async () => {
    await post({ ...edit, meetingScope: JSON.stringify({ type: "Group", groupId: "g1", extraUserIds: ["u2"] }) });
    expect(vi.mocked(updateScheduledMeeting).mock.calls[0]![2].scope).toEqual({
      type: "Group",
      groupId: "g1",
      extraUserIds: ["u2"],
    });

    await post({ ...edit, meetingScope: JSON.stringify({ type: "UserList", participantUserIds: ["u2", "u3"] }) });
    expect(vi.mocked(updateScheduledMeeting).mock.calls[1]![2].scope).toEqual({
      type: "UserList",
      participantUserIds: ["u2", "u3"],
    });

    await post({ ...edit, meetingScope: JSON.stringify({ type: "Group" }) });
    expect(vi.mocked(updateScheduledMeeting).mock.calls[2]![2].scope).toEqual({ type: "None" });
  });

  it("rejects unreadable guest data", async () => {
    expect((await post({ ...edit, meetingScope: "{oops" }))!.status).toBe(400);
    expect((await post({ ...edit, guestEmails: "{oops" }))!.status).toBe(400);
    expect(updateScheduledMeeting).not.toHaveBeenCalled();
  });

  it("keeps only string guest emails, and treats a non-array as an empty list", async () => {
    await post({ ...edit, guestEmails: JSON.stringify(["ada@example.edu", 4, null]) });
    expect(vi.mocked(updateScheduledMeeting).mock.calls[0]![2].guestEmails).toEqual(["ada@example.edu"]);

    await post({ ...edit, guestEmails: JSON.stringify({ a: 1 }) });
    expect(vi.mocked(updateScheduledMeeting).mock.calls[1]![2].guestEmails).toEqual([]);
  });

  it("validates title and time range before updating", async () => {
    expect((await post({ ...edit, title: " " }))!.status).toBe(400);
    expect((await post({ ...edit, startIso: "" }))!.status).toBe(400);
    expect((await post({ ...edit, endIso: START }))!.status).toBe(400);
    expect((await post({ ...edit, endIso: "2026-11-09T13:00:00.000Z" }))!.status).toBe(400);
    expect(updateScheduledMeeting).not.toHaveBeenCalled();
  });

  it("returns the update's refusal", async () => {
    vi.mocked(updateScheduledMeeting).mockResolvedValue({ ok: false, error: "Only the organizer or Core", status: 403 } as never);

    const res = await post(edit);

    expect(res!.status).toBe(403);
    expect(await res!.json()).toEqual({ error: "Only the organizer or Core" });
  });

  describe("count this as work", () => {
    const work = { ...edit, isWork: "1", assignmentType: "Project", roleRefId: "r9" };

    it("logs the editor's hours when they own the destination link", async () => {
      await post(work);

      expect(db.userCalendarLink!.findFirst).toHaveBeenCalledWith({
        where: { id: "l1", userId: "u1" },
        select: { id: true },
      });
      expect(db.timeEntry!.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sourceEventId_userId: { sourceEventId: "ev1", userId: "u1" } } }),
      );
    });

    it("skips work entirely when the editor does not own the link (Core editing someone else's meeting)", async () => {
      db.userCalendarLink!.findFirst!.mockResolvedValue(null);

      expect(await post(work)).toBeNull();
      expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
    });

    it("skips work for scoped or series edits", async () => {
      await post({ ...work, scope: "this" });
      await post({ ...work, recurringEventId: "master" });

      expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
    });

    it("rejects an unusable role or an all-day event after the meeting was saved", async () => {
      vi.mocked(resolveRoleRef).mockResolvedValue(null as never);
      expect((await post(work))!.status).toBe(400);

      vi.mocked(resolveRoleRef).mockResolvedValue({ projectId: null } as never);
      expect((await post({ ...work, allDay: "1" }))!.status).toBe(400);
      expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
    });

    it("clears the linked hours on clearWork", async () => {
      await post({ ...edit, clearWork: "1" });

      expect(db.timeEntry!.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", sourceEventId: "ev1" } });
    });
  });
});
