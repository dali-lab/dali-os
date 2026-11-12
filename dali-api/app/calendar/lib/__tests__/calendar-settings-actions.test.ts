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
import { isLabMember } from "~/lib/roles";
import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import { setSubCalendarEnabled } from "~/calendar/lib/sub-calendar.server";
import { resolveTermFilter } from "~/lib/terms";
import {
  createClass,
  updateClass,
  removeClass,
  refreshClass,
  MemberClassError,
} from "~/lib/member-class.server";
import { addTimeEntry } from "~/calendar/lib/time-entries.server";
import { setUserTimesheetSync, removeTimeEntryFromGoogle } from "~/calendar/lib/timesheet-mirror.server";
import {
  createCalendar,
  patchCalendar,
  deleteCalendar,
  subscribeCalendarForLink,
} from "~/calendar/lib/google-calendar.server";
import { generalCalendarId } from "~/calendar/lib/general-calendar";
import { trackExternalEventAsMeeting } from "~/calendar/lib/scheduled-meeting.server";
import {
  attachMeetingNote,
  attachMeetingWhiteboard,
  setMeetingProject,
} from "~/calendar/lib/meeting-artifacts.server";
import { resolveMeetingOccurrence } from "~/calendar/lib/meeting-roster.server";
import { meetingNotePath } from "~/lib/note-path.server";
import { submitCalendarAction, shouldInvalidateExternalCache } from "~/calendar/lib/calendar-actions.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return submitCalendarAction(new Request("http://localhost/calendar", { method: "POST", body }));
}

async function bodyOf(res: Response | null | undefined) {
  return res ? { status: res.status, json: await res.json() } : null;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(markCalendarChanged).mockResolvedValue(undefined as never);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", type: "member" } } as never);
  vi.mocked(isLabMember).mockResolvedValue(true);
  db.$transaction!.mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => unknown)(prisma));
  db.workingHoursDay!.deleteMany!.mockResolvedValue({ count: 0 });
  db.workingHoursDay!.createMany!.mockResolvedValue({ count: 0 });
  db.timeEntry!.deleteMany!.mockResolvedValue({ count: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("submitCalendarAction gating", () => {
  it("returns the auth response when signed out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);

    expect((await post({ intent: "reset-working-hours" }))!.status).toBe(401);
    expect(db.workingHoursDay!.deleteMany).not.toHaveBeenCalled();
  });

  it.each(["subscribe-general-calendar", "toggle-meeting-time-entry", "add-meeting-note", "track-event-as-meeting"])(
    "refuses %s for someone who is not a lab member",
    async (intent) => {
      vi.mocked(isLabMember).mockResolvedValue(false);

      const res = await post({ intent });

      expect(res!.status).toBe(403);
      expect(setUserTimesheetSync).not.toHaveBeenCalled();
      expect(attachMeetingNote).not.toHaveBeenCalled();
      expect(trackExternalEventAsMeeting).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown intent as invalid input", async () => {
    const res = await post({ intent: "nope" });

    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toBe("Invalid input");
  });

  it("stamps the Google cache before and after a write that can change what Google returns", async () => {
    await post({ intent: "cal-rename", linkId: "" });

    expect(markCalendarChanged).toHaveBeenCalledTimes(2);
    expect(markCalendarChanged).toHaveBeenCalledWith("u1");
  });

  it("stamps the cache again even when the handler throws", async () => {
    db.workingHoursDay!.deleteMany!.mockResolvedValue({ count: 0 });
    vi.mocked(setUserTimesheetSync).mockRejectedValue(new Error("boom"));

    await expect(post({ intent: "set-timesheet-sync", enabled: "true" })).rejects.toThrow("boom");

    expect(markCalendarChanged).toHaveBeenCalledTimes(2);
  });

  it("leaves the Google cache alone for DB-only intents", async () => {
    await post({ intent: "reset-working-hours" });

    expect(markCalendarChanged).not.toHaveBeenCalled();
  });

  it.each([
    ["set-working-segments", false],
    ["add-meeting-note", false],
    ["toggle-meeting-time-entry", false],
    ["toggle-sub-calendar", false],
    ["event-create", true],
    ["event-move", true],
    ["add-time-entry", true],
    ["set-timesheet-sync", true],
    ["remove-calendar-link", true],
    ["class-add", true],
  ])("shouldInvalidateExternalCache(%s) is %s", (intent, expected) => {
    expect(shouldInvalidateExternalCache(intent)).toBe(expected);
  });
});

describe("working hours", () => {
  it("replaces a day's segments in one transaction", async () => {
    const res = await post({
      intent: "set-working-segments",
      dayOfWeek: "2",
      segments: JSON.stringify([
        { startMinute: 540, endMinute: 720, location: "InPerson" },
        { startMinute: 780, endMinute: 1020, location: "Remote" },
      ]),
    });

    expect(res).toBeNull();
    expect(db.workingHoursDay!.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", dayOfWeek: 2 } });
    expect(db.workingHoursDay!.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "u1", dayOfWeek: 2, enabled: true, startMinute: 540, endMinute: 720, location: "InPerson" },
        { userId: "u1", dayOfWeek: 2, enabled: true, startMinute: 780, endMinute: 1020, location: "Remote" },
      ],
    });
  });

  it("records an explicitly cleared day as a disabled sentinel row, not as no rows", async () => {
    await post({ intent: "set-working-segments", dayOfWeek: "3", segments: "[]" });

    expect(db.workingHoursDay!.createMany).not.toHaveBeenCalled();
    expect(db.workingHoursDay!.create).toHaveBeenCalledWith({
      data: { userId: "u1", dayOfWeek: 3, enabled: false, startMinute: 0, endMinute: 1, location: "InPerson" },
    });
  });

  it("rejects malformed segments instead of clearing the day", async () => {
    const res = await post({ intent: "set-working-segments", dayOfWeek: "3", segments: "{not json" });

    expect(res!.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.workingHoursDay!.create).not.toHaveBeenCalled();
  });

  it("rejects a segment that ends before it starts", async () => {
    const res = await post({
      intent: "set-working-segments",
      dayOfWeek: "1",
      segments: JSON.stringify([{ startMinute: 600, endMinute: 600, location: "InPerson" }]),
    });

    expect(res!.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("copies Monday's enabled segments over Tuesday to Friday", async () => {
    db.workingHoursDay!.findMany!.mockResolvedValue([
      { startMinute: 540, endMinute: 720, location: "InPerson", enabled: true },
    ]);

    await post({ intent: "copy-weekdays" });

    expect(db.workingHoursDay!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", dayOfWeek: 1, enabled: true } }),
    );
    expect(db.workingHoursDay!.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", dayOfWeek: { in: [2, 3, 4, 5] } },
    });
    const data = db.workingHoursDay!.createMany!.mock.calls[0]![0].data;
    expect(data.map((r: { dayOfWeek: number }) => r.dayOfWeek)).toEqual([2, 3, 4, 5]);
    expect(data[0]).toEqual({
      userId: "u1",
      dayOfWeek: 2,
      enabled: true,
      startMinute: 540,
      endMinute: 720,
      location: "InPerson",
    });
  });

  it("copies nothing, and wipes nothing, when Monday has no hours", async () => {
    db.workingHoursDay!.findMany!.mockResolvedValue([]);

    await post({ intent: "copy-weekdays" });

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("clears every row on reset", async () => {
    await post({ intent: "reset-working-hours" });

    expect(db.workingHoursDay!.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("seeds the whole week at once, with a disabled sentinel for empty days", async () => {
    await post({
      intent: "seed-working-hours",
      days: JSON.stringify([
        { dayOfWeek: 0, segments: [] },
        { dayOfWeek: 1, segments: [{ startMinute: 540, endMinute: 1020, location: "InPerson" }] },
      ]),
    });

    expect(db.workingHoursDay!.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.workingHoursDay!.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "u1", dayOfWeek: 0, enabled: false, startMinute: 0, endMinute: 1, location: "InPerson" },
        { userId: "u1", dayOfWeek: 1, enabled: true, startMinute: 540, endMinute: 1020, location: "InPerson" },
      ],
    });
  });

  it("rejects a seed containing an inverted segment before deleting anything", async () => {
    const res = await post({
      intent: "seed-working-hours",
      days: JSON.stringify([{ dayOfWeek: 1, segments: [{ startMinute: 700, endMinute: 600, location: "InPerson" }] }]),
    });

    expect(res!.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("skips the insert when a seed has no days", async () => {
    await post({ intent: "seed-working-hours", days: "[]" });

    expect(db.workingHoursDay!.deleteMany).toHaveBeenCalled();
    expect(db.workingHoursDay!.createMany).not.toHaveBeenCalled();
  });

  it("upserts the default event buffer for the signed-in user", async () => {
    db.userAvailabilitySettings!.upsert = vi.fn();
    await post({ intent: "set-event-buffer", defaultEventBufferMin: "10" });

    expect(db.userAvailabilitySettings!.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", defaultEventBufferMin: 10 },
      update: { defaultEventBufferMin: 10 },
    });
  });
});

describe("calendar links", () => {
  it("removes only a link the user owns", async () => {
    db.userCalendarLink!.findUnique!.mockResolvedValue({ id: "l1", userId: "u1" });

    expect(await post({ intent: "remove-calendar-link", linkId: "l1" })).toBeNull();
    expect(db.userCalendarLink!.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
  });

  it("404s removing someone else's link, or a missing one", async () => {
    db.userCalendarLink!.findUnique!.mockResolvedValue({ id: "l1", userId: "other" });
    expect((await post({ intent: "remove-calendar-link", linkId: "l1" }))!.status).toBe(404);

    db.userCalendarLink!.findUnique!.mockResolvedValue(null);
    expect((await post({ intent: "remove-calendar-link", linkId: "l1" }))!.status).toBe(404);
    expect(db.userCalendarLink!.delete).not.toHaveBeenCalled();
  });

  it("toggles a sub-calendar on the user's own link, parsing enabled from the form string", async () => {
    db.userCalendarLink!.findUnique!.mockResolvedValue({ id: "l1", userId: "u1" });

    await post({ intent: "toggle-sub-calendar", linkId: "l1", calendarId: "c1", enabled: "true" });
    await post({ intent: "toggle-sub-calendar", linkId: "l1", calendarId: "c1", enabled: "false" });

    expect(vi.mocked(setSubCalendarEnabled).mock.calls).toEqual([
      ["l1", "c1", true],
      ["l1", "c1", false],
    ]);
  });

  it("will not toggle a sub-calendar on someone else's link", async () => {
    db.userCalendarLink!.findUnique!.mockResolvedValue({ id: "l1", userId: "other" });

    const res = await post({ intent: "toggle-sub-calendar", linkId: "l1", calendarId: "c1", enabled: "true" });

    expect(res!.status).toBe(404);
    expect(setSubCalendarEnabled).not.toHaveBeenCalled();
  });

  describe("subscribe-general-calendar", () => {
    it("400s when no DALI calendar is configured", async () => {
      vi.mocked(generalCalendarId).mockReturnValue(null);

      expect((await post({ intent: "subscribe-general-calendar", linkId: "l1" }))!.status).toBe(400);
    });

    it("404s a link that is not the user's Google link", async () => {
      vi.mocked(generalCalendarId).mockReturnValue("general@group.calendar.google.com");
      db.userCalendarLink!.findUnique!.mockResolvedValue({ id: "l1", userId: "u1", provider: "Outlook" });

      expect((await post({ intent: "subscribe-general-calendar", linkId: "l1" }))!.status).toBe(404);
      expect(subscribeCalendarForLink).not.toHaveBeenCalled();
    });

    it("subscribes the link to the general calendar", async () => {
      vi.mocked(generalCalendarId).mockReturnValue("general@group.calendar.google.com");
      db.userCalendarLink!.findUnique!.mockResolvedValue({ id: "l1", userId: "u1", provider: "Google" });

      expect(await post({ intent: "subscribe-general-calendar", linkId: "l1" })).toBeNull();
      expect(subscribeCalendarForLink).toHaveBeenCalledWith("l1", "general@group.calendar.google.com");
    });

    it("answers 502 with Google's message when the subscribe fails", async () => {
      vi.mocked(generalCalendarId).mockReturnValue("g");
      db.userCalendarLink!.findUnique!.mockResolvedValue({ id: "l1", userId: "u1", provider: "Google" });
      vi.mocked(subscribeCalendarForLink).mockRejectedValue(new Error("quota"));

      expect(await bodyOf(await post({ intent: "subscribe-general-calendar", linkId: "l1" }))).toEqual({
        status: 502,
        json: { error: "quota" },
      });
    });
  });
});

describe("set-timesheet-sync", () => {
  it("passes the toggle through for the signed-in user", async () => {
    vi.mocked(setUserTimesheetSync).mockResolvedValue({ ok: true } as never);

    expect(await post({ intent: "set-timesheet-sync", enabled: "true" })).toBeNull();
    expect(setUserTimesheetSync).toHaveBeenCalledWith("u1", true);
  });

  it("asks for a DALI Google link when there is none", async () => {
    vi.mocked(setUserTimesheetSync).mockResolvedValue({ ok: false, reason: "needsDaliLink" } as never);

    expect(await bodyOf(await post({ intent: "set-timesheet-sync", enabled: "true" }))).toEqual({
      status: 400,
      json: { error: "Connect your @dali.dartmouth.edu Google account first.", needsDaliLink: true },
    });
  });

  it("surfaces any other failure as a 502", async () => {
    vi.mocked(setUserTimesheetSync).mockResolvedValue({ ok: false, reason: "google", message: "Google said no" } as never);

    expect(await bodyOf(await post({ intent: "set-timesheet-sync", enabled: "false" }))).toEqual({
      status: 502,
      json: { error: "Google said no" },
    });
  });
});

describe("add-time-entry failure", () => {
  it("returns the entry rules' status and message", async () => {
    vi.mocked(addTimeEntry).mockResolvedValue({ ok: false, error: "Pick a role", status: 422 } as never);

    expect(await bodyOf(await post({
          intent: "add-time-entry",
          date: "2026-10-21",
          hours: "2",
          assignmentType: "Project",
          roleRefId: "r1",
          startTime: "2026-10-21T13:00:00.000Z",
          endTime: "2026-10-21T15:00:00.000Z",
        }))).toEqual({
      status: 422,
      json: { error: "Pick a role" },
    });
  });
});

describe("toggle-meeting-time-entry", () => {
  const start = new Date("2026-11-10T15:00:00.000Z");
  const end = new Date("2026-11-10T16:30:00.000Z");
  const meeting = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    status: "Confirmed",
    projectId: "p1",
    selectedAt: start,
    organizerId: "org",
    participantUserIds: ["u1"],
    scopeType: "UserList",
    ...over,
  });
  const key = { scheduledMeetingId: "m1", occurrenceStart: start, userId: "u1" };
  const on = { intent: "toggle-meeting-time-entry", meetingId: "m1", onTimesheet: "true" };

  beforeEach(() => {
    db.scheduledMeeting!.findUnique!.mockResolvedValue(meeting());
    vi.mocked(resolveMeetingOccurrence).mockResolvedValue({ originalStart: start, start, end } as never);
  });

  it("404s a missing or cancelled meeting", async () => {
    db.scheduledMeeting!.findUnique!.mockResolvedValue(null);
    expect((await post(on))!.status).toBe(404);

    db.scheduledMeeting!.findUnique!.mockResolvedValue(meeting({ status: "Cancelled" }));
    expect((await post(on))!.status).toBe(404);
    expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
  });

  it("refuses someone who was not invited to a scoped meeting", async () => {
    db.scheduledMeeting!.findUnique!.mockResolvedValue(meeting({ participantUserIds: ["other"] }));

    const res = await post(on);

    expect(res!.status).toBe(403);
    expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
  });

  it("lets the organizer log it even when not on the participant list", async () => {
    db.scheduledMeeting!.findUnique!.mockResolvedValue(meeting({ organizerId: "u1", participantUserIds: [] }));

    expect(await post(on)).toBeNull();
    expect(db.timeEntry!.upsert).toHaveBeenCalled();
  });

  it("lets any lab member log an open (None scope) meeting they were not individually invited to", async () => {
    db.scheduledMeeting!.findUnique!.mockResolvedValue(meeting({ scopeType: "None", participantUserIds: [] }));

    expect(await post(on)).toBeNull();
    expect(db.timeEntry!.upsert).toHaveBeenCalled();
  });

  it("upserts a Meeting-sourced row from the occurrence, keyed per user and occurrence, with hours from its length", async () => {
    expect(await post(on)).toBeNull();

    expect(db.timeEntry!.upsert).toHaveBeenCalledWith({
      where: { scheduledMeetingId_occurrenceStart_userId: key },
      create: {
        ...key,
        source: "Meeting",
        projectId: "p1",
        date: start,
        hours: 1.5,
        startTime: start,
        endTime: end,
      },
      update: { projectId: "p1", date: start, hours: 1.5, startTime: start, endTime: end },
    });
  });

  it("resolves the occurrence the client named", async () => {
    await post({ ...on, occurrence: "2026-11-10T15:00:00.000Z" });

    expect(vi.mocked(resolveMeetingOccurrence).mock.calls[0]![1]).toEqual({ parsed: "2026-11-10T15:00:00.000Z" });
  });

  it("refuses to log a meeting that has no scheduled time yet", async () => {
    db.scheduledMeeting!.findUnique!.mockResolvedValue(meeting({ selectedAt: null }));

    const res = await post(on);

    expect(res!.status).toBe(400);
    expect(db.timeEntry!.upsert).not.toHaveBeenCalled();
  });

  it("removes the row and its Google mirror when switched off", async () => {
    const existing = { id: "t1" };
    db.timeEntry!.findUnique!.mockResolvedValue(existing);
    vi.mocked(removeTimeEntryFromGoogle).mockResolvedValue(undefined as never);

    expect(await post({ ...on, onTimesheet: "false" })).toBeNull();

    expect(removeTimeEntryFromGoogle).toHaveBeenCalledWith(existing);
    expect(db.timeEntry!.deleteMany).toHaveBeenCalledWith({ where: key });
  });

  it("still deletes the row when the Google cleanup fails, and skips cleanup when there is no row", async () => {
    db.timeEntry!.findUnique!.mockResolvedValue({ id: "t1" });
    vi.mocked(removeTimeEntryFromGoogle).mockRejectedValue(new Error("gone"));
    await post({ ...on, onTimesheet: "false" });
    expect(db.timeEntry!.deleteMany).toHaveBeenCalledTimes(1);

    db.timeEntry!.findUnique!.mockResolvedValue(null);
    vi.mocked(removeTimeEntryFromGoogle).mockClear();
    await post({ ...on, onTimesheet: "false" });
    expect(removeTimeEntryFromGoogle).not.toHaveBeenCalled();
  });

  it("can switch a meeting off even though it has no scheduled time", async () => {
    db.scheduledMeeting!.findUnique!.mockResolvedValue(meeting({ selectedAt: null }));

    expect(await post({ ...on, onTimesheet: "false" })).toBeNull();
    expect(db.timeEntry!.deleteMany).toHaveBeenCalled();
  });
});

describe("meeting attachments", () => {
  it("sets a meeting's project as the signed-in user, returning the refusal status", async () => {
    vi.mocked(setMeetingProject).mockResolvedValue({ ok: true } as never);
    const ok = await post({
      intent: "set-meeting-project",
      meetingId: "m1",
      projectId: "p1",
      meetingType: "Team",
    });
    expect(await bodyOf(ok)).toEqual({ status: 200, json: { ok: true } });
    expect(setMeetingProject).toHaveBeenCalledWith({
      meetingId: "m1",
      actorId: "u1",
      projectId: "p1",
      meetingType: "Team",
      meetingTypeLabel: null,
    });

    vi.mocked(setMeetingProject).mockResolvedValue({ ok: false, error: "Not yours", status: 403 } as never);
    expect(await bodyOf(await post({ intent: "set-meeting-project", meetingId: "m1", projectId: "p1", meetingType: "Team" }))).toEqual({
      status: 403,
      json: { error: "Not yours" },
    });
  });

  it("attaches a note, parsing the notebook choice, and returns where it lives", async () => {
    vi.mocked(attachMeetingNote).mockResolvedValue({
      ok: true,
      notePageId: "n1",
      notebookId: "nb1",
      createdNotebook: true,
      seriesNotebookId: null,
    } as never);
    vi.mocked(meetingNotePath).mockResolvedValue("/drive/n1" as never);

    const res = await post({
      intent: "add-meeting-note",
      meetingId: "m1",
      meetingType: "Team",
      projectId: "p1",
      notebook: JSON.stringify({ existingId: "nb1" }),
    });

    expect(await bodyOf(res)).toEqual({
      status: 200,
      json: { ok: true, notePageId: "n1", notebookId: "nb1", createdNotebook: true, seriesNotebookId: null, notePath: "/drive/n1" },
    });
    expect(vi.mocked(attachMeetingNote).mock.calls[0]![0]).toMatchObject({
      meetingId: "m1",
      actorId: "u1",
      projectId: "p1",
      notebook: { existingId: "nb1" },
    });
    expect(meetingNotePath).toHaveBeenCalledWith(
      expect.objectContaining({ notePageId: "n1", notebookId: "nb1", viewerSub: "u1" }),
    );
  });

  it("returns the note refusal as-is", async () => {
    vi.mocked(attachMeetingNote).mockResolvedValue({ ok: false, error: "Only the organizer", status: 403 } as never);

    expect(
      await bodyOf(await post({ intent: "add-meeting-note", meetingId: "m1", meetingType: "Team", projectId: "p1" })),
    ).toEqual({ status: 403, json: { error: "Only the organizer" } });
    expect(meetingNotePath).not.toHaveBeenCalled();
  });

  it("attaches a whiteboard, leaving the type fields null when omitted", async () => {
    vi.mocked(attachMeetingWhiteboard).mockResolvedValue({ ok: true, whiteboardPageId: "w1" } as never);

    const res = await post({ intent: "add-meeting-whiteboard", meetingId: "m1" });

    expect(await bodyOf(res)).toEqual({ status: 200, json: { ok: true, whiteboardPageId: "w1" } });
    expect(attachMeetingWhiteboard).toHaveBeenCalledWith({
      meetingId: "m1",
      actorId: "u1",
      meetingType: null,
      meetingTypeLabel: null,
      projectId: null,
    });
  });

  it("returns the whiteboard refusal as-is", async () => {
    vi.mocked(attachMeetingWhiteboard).mockResolvedValue({ ok: false, error: "No", status: 404 } as never);

    expect((await post({ intent: "add-meeting-whiteboard", meetingId: "m1" }))!.status).toBe(404);
  });

  it("tracks an external event as a meeting", async () => {
    vi.mocked(trackExternalEventAsMeeting).mockResolvedValue({ ok: true, meeting: { id: "m9" } } as never);

    const res = await post({
      intent: "track-event-as-meeting",
      eventId: "e1",
      linkId: "l1",
      calendarId: "c1",
    });

    expect(await bodyOf(res)).toEqual({ status: 200, json: { ok: true, meetingId: "m9" } });
    expect(trackExternalEventAsMeeting).toHaveBeenCalledWith({
      actorId: "u1",
      eventId: "e1",
      recurringEventId: null,
      linkId: "l1",
      calendarId: "c1",
    });
  });

  it("returns the track refusal as-is", async () => {
    vi.mocked(trackExternalEventAsMeeting).mockResolvedValue({ ok: false, error: "Not on this event", status: 403 } as never);

    expect(
      (await post({ intent: "track-event-as-meeting", eventId: "e1", linkId: "l1", calendarId: "c1" }))!.status,
    ).toBe(403);
  });
});

describe("cal-* (linked Google calendars)", () => {
  beforeEach(() => {
    db.userCalendarLink!.findFirst!.mockResolvedValue({ id: "l1" });
  });

  it("needs an account", async () => {
    expect((await post({ intent: "cal-create", summary: "X" }))!.status).toBe(400);
  });

  it("will not touch a link the user does not own", async () => {
    db.userCalendarLink!.findFirst!.mockResolvedValue(null);

    const res = await post({ intent: "cal-create", linkId: "l1", summary: "X" });

    expect(res!.status).toBe(500);
    expect((await res!.json()).error).toMatch(/isn't connected/);
    expect(createCalendar).not.toHaveBeenCalled();
    expect(db.userCalendarLink!.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "l1", userId: "u1", provider: "Google" } }),
    );
  });

  it("creates, subscribes and enables a new calendar", async () => {
    vi.mocked(createCalendar).mockResolvedValue("new-cal");
    vi.mocked(subscribeCalendarForLink).mockRejectedValue(new Error("already"));

    expect(await post({ intent: "cal-create", linkId: "l1", summary: "  Lab  " })).toBeNull();

    expect(createCalendar).toHaveBeenCalledWith("l1", "Lab");
    expect(setSubCalendarEnabled).toHaveBeenCalledWith("l1", "new-cal", true);
  });

  it("requires a name to create or rename", async () => {
    expect((await post({ intent: "cal-create", linkId: "l1", summary: " " }))!.status).toBe(400);
    expect((await post({ intent: "cal-rename", linkId: "l1", calendarId: "c1", summary: "" }))!.status).toBe(400);
    expect((await post({ intent: "cal-rename", linkId: "l1", summary: "x" }))!.status).toBe(400);
    expect(createCalendar).not.toHaveBeenCalled();
    expect(patchCalendar).not.toHaveBeenCalled();
  });

  it("renames and deletes a calendar", async () => {
    expect(await post({ intent: "cal-rename", linkId: "l1", calendarId: "c1", summary: "New" })).toBeNull();
    expect(patchCalendar).toHaveBeenCalledWith({ linkId: "l1", calendarId: "c1", summary: "New" });

    expect(await post({ intent: "cal-delete", linkId: "l1", calendarId: "c1" })).toBeNull();
    expect(deleteCalendar).toHaveBeenCalledWith("l1", "c1");
  });

  it("requires a calendar id to delete", async () => {
    expect((await post({ intent: "cal-delete", linkId: "l1" }))!.status).toBe(400);
    expect(deleteCalendar).not.toHaveBeenCalled();
  });

  it("rejects an unknown cal action and reports Google failures as 500 with the message", async () => {
    expect((await post({ intent: "cal-wat", linkId: "l1" }))!.status).toBe(400);

    vi.mocked(deleteCalendar).mockRejectedValue(new Error("Google exploded"));
    expect(await bodyOf(await post({ intent: "cal-delete", linkId: "l1", calendarId: "c1" }))).toEqual({
      status: 500,
      json: { error: "Google exploded" },
    });
  });
});

describe("class-* actions", () => {
  const terms = [
    { id: "t-old", isCurrent: false },
    { id: "t-cur", isCurrent: true },
    { id: "t-next", isCurrent: false },
  ];
  const classFields = {
    intent: "class-add",
    title: "  Intro to Everything ",
    periodCode: "10",
    termId: "t-next",
    location: " Room 1 ",
    includeXHour: "on",
    destination: "local",
    offeringCrn: "12345",
  };

  beforeEach(() => {
    vi.mocked(resolveTermFilter).mockResolvedValue({ termIds: ["t-cur", "t-next"], terms } as never);
  });

  it("removes and refreshes by class id, and needs the id", async () => {
    expect(await post({ intent: "class-remove", classId: "c1" })).toBeNull();
    expect(removeClass).toHaveBeenCalledWith("u1", "c1");
    expect(await post({ intent: "class-refresh", classId: "c1" })).toBeNull();
    expect(refreshClass).toHaveBeenCalledWith("u1", "c1");

    expect((await post({ intent: "class-remove" }))!.status).toBe(400);
    expect((await post({ intent: "class-refresh" }))!.status).toBe(400);
  });

  it("adds a class in an allowed term with trimmed fields and timetable provenance", async () => {
    expect(await post(classFields)).toBeNull();

    expect(createClass).toHaveBeenCalledWith({
      userId: "u1",
      termId: "t-next",
      title: "Intro to Everything",
      location: "Room 1",
      periodCode: "10",
      includeXHour: true,
      customMeetings: undefined,
      destination: { parsed: "local" },
      offeringCrn: "12345",
      subject: null,
      courseNumber: null,
      section: null,
    });
  });

  it("falls back to the current term when the submitted term is not allowed", async () => {
    await post({ ...classFields, termId: "t-old" });

    expect(vi.mocked(createClass).mock.calls[0]![0]).toMatchObject({ termId: "t-cur" });
  });

  it("falls back to the first allowed term when none is current", async () => {
    vi.mocked(resolveTermFilter).mockResolvedValue({
      termIds: ["t-next"],
      terms: [{ id: "t-next", isCurrent: false }],
    } as never);

    await post({ ...classFields, termId: "" });

    expect(vi.mocked(createClass).mock.calls[0]![0]).toMatchObject({ termId: "t-next" });
  });

  it("refuses when there is no active term", async () => {
    vi.mocked(resolveTermFilter).mockResolvedValue({ termIds: [], terms: [] } as never);

    expect((await post(classFields))!.status).toBe(400);
    expect(createClass).not.toHaveBeenCalled();
  });

  it("requires a class name", async () => {
    expect((await post({ ...classFields, title: "  " }))!.status).toBe(400);
    expect(createClass).not.toHaveBeenCalled();
  });

  it("builds a single custom meeting from days and times when no period is picked", async () => {
    await post({
      intent: "class-add",
      title: "Seminar",
      termId: "t-cur",
      customDays: "1, 3,9,x",
      customStart: "9:05",
      customEnd: "10:30",
    });

    expect(vi.mocked(createClass).mock.calls[0]![0]).toMatchObject({
      periodCode: null,
      includeXHour: false,
      customMeetings: [{ kind: "main", days: [1, 3], startMin: 545, endMin: 630 }],
    });
  });

  it.each([
    ["no days picked", { customDays: "", customStart: "09:00", customEnd: "10:00" }],
    ["only blank days", { customDays: " , ", customStart: "09:00", customEnd: "10:00" }],
    ["only out-of-range days", { customDays: "7,9", customStart: "09:00", customEnd: "10:00" }],
    ["an unparseable start", { customDays: "1", customStart: "9am", customEnd: "10:00" }],
    ["an out-of-range hour", { customDays: "1", customStart: "09:00", customEnd: "24:00" }],
    ["an out-of-range minute", { customDays: "1", customStart: "09:60", customEnd: "10:00" }],
    ["an end that is not after the start", { customDays: "1", customStart: "10:00", customEnd: "10:00" }],
  ])("asks for a period or custom time when given %s", async (_l, extra) => {
    const res = await post({ intent: "class-add", title: "Seminar", termId: "t-cur", ...extra });

    expect(res!.status).toBe(400);
    expect(createClass).not.toHaveBeenCalled();
  });

  it("updates an existing class and needs its id", async () => {
    expect(await post({ ...classFields, intent: "class-update", classId: "c1" })).toBeNull();
    expect(updateClass).toHaveBeenCalledWith("c1", expect.objectContaining({ userId: "u1", termId: "t-next" }));

    expect((await post({ ...classFields, intent: "class-update" }))!.status).toBe(400);
  });

  it("rejects an unknown class action", async () => {
    expect((await post({ ...classFields, intent: "class-wat" }))!.status).toBe(400);
  });

  it("shows a class rule violation as a 400 with its message", async () => {
    vi.mocked(createClass).mockRejectedValue(new MemberClassError("That period doesn't exist"));

    expect(await bodyOf(await post(classFields))).toEqual({
      status: 400,
      json: { error: "That period doesn't exist" },
    });
  });

  it("hides unexpected failures behind a generic 500", async () => {
    vi.mocked(createClass).mockRejectedValue(new Error("pg down"));

    const res = await bodyOf(await post(classFields));

    expect(res!.status).toBe(500);
    expect(JSON.stringify(res!.json)).not.toContain("pg down");
  });
});
