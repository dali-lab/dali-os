import { describe, it, expect, beforeEach, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  userAvailabilitySettings: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  workingHoursDay: { findMany: vi.fn() },
  userCalendarLink: { findMany: vi.fn() },
  memberClass: { findMany: vi.fn() },
  timeEntry: { findMany: vi.fn() },
  scheduledMeeting: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(),
  redirectNonMemberToPortal: vi.fn(),
  isImpersonating: vi.fn(() => false),
}));
vi.mock("~/lib/roles", () => ({
  isLabMember: vi.fn(),
  currentTerm: vi.fn(),
  getUserRoleInstances: vi.fn(),
  canViewForms: vi.fn(),
  isCore: vi.fn(),
  getUserRoles: vi.fn(),
}));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/calendar/lib/meeting-link.server", () => ({ meetingLinkRedirect: vi.fn(async () => null) }));
vi.mock("~/lib/google-calendar", () => ({
  fetchCalendarEvents: vi.fn(),
  getValidAccessTokenForLink: vi.fn(),
  listCalendarsForLink: vi.fn(),
}));

import { requireAuth, redirectNonMemberToPortal, isImpersonating } from "~/lib/auth";
import { isLabMember, currentTerm, getUserRoleInstances, canViewForms, isCore, getUserRoles } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { fetchCalendarEvents, getValidAccessTokenForLink, listCalendarsForLink } from "~/lib/google-calendar";
import { invalidateExternalCache } from "~/calendar/lib/external-cache.server";
import { loadCalendarData } from "~/calendar/lib/calendar-loader.server";

const USER = "u1";
const LINK = {
  id: "l1",
  provider: "Google",
  externalEmail: "ada@example.edu",
  displayName: null,
  enabled: true,
  primary: true,
  syncError: null,
  subCalendarIds: [],
};
const event = (over: Record<string, unknown> = {}) => ({
  startIso: "2026-11-02T15:00:00.000Z",
  endIso: "2026-11-02T16:00:00.000Z",
  title: "Standup",
  calendarId: "primary",
  eventId: "ev1",
  linkId: "l1",
  allDay: false,
  writable: true,
  ...over,
});
const request = new Request("http://localhost/calendar");
const run = (opts?: { portal?: boolean }) => loadCalendarData(request, opts) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  invalidateExternalCache(USER);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(isImpersonating).mockReturnValue(false);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26F" } as never);
  vi.mocked(getUserRoleInstances).mockResolvedValue([] as never);
  vi.mocked(canViewForms).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(resolveTermFilter).mockResolvedValue({ terms: [], termIds: [] } as never);
  vi.mocked(getValidAccessTokenForLink).mockResolvedValue("tok");
  vi.mocked(listCalendarsForLink).mockResolvedValue([
    { id: "primary", summary: "Primary", primary: true, accessRole: "owner" },
  ] as never);
  vi.mocked(fetchCalendarEvents).mockResolvedValue([event()] as never);
  prisma.userAvailabilitySettings.findUnique.mockResolvedValue({
    defaultEventBufferMin: 10,
    timesheetGoogleSync: false,
    timesheetCalendarId: null,
  });
  prisma.user.findUnique.mockResolvedValue({ timeZone: "America/New_York", calendarDataChangedAt: null });
  prisma.workingHoursDay.findMany.mockResolvedValue([]);
  prisma.userCalendarLink.findMany.mockResolvedValue([LINK]);
  prisma.memberClass.findMany.mockResolvedValue([]);
  prisma.timeEntry.findMany.mockResolvedValue([]);
  prisma.scheduledMeeting.findMany.mockResolvedValue([]);
});

describe("loadCalendarData", () => {
  it("sends a lab member on the portal mount to /calendar before reading anything", async () => {
    const res = await run({ portal: true });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("Location")).toBe("/calendar");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(getValidAccessTokenForLink).not.toHaveBeenCalled();
  });

  it("serves a non-member on the portal mount without the directory", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    const data = await run({ portal: true });
    expect(data.hasDirectory).toBe(false);
  });

  it("assembles events, linked calendars and the database layers together", async () => {
    prisma.workingHoursDay.findMany.mockResolvedValue([
      { id: "w1", dayOfWeek: 1, startMinute: 540, endMinute: 1020, location: null, enabled: true },
    ]);
    const data = await run();
    expect(data.externalEvents).toMatchObject([{ eventId: "ev1", title: "Standup" }]);
    expect(data.ingestionError).toBeNull();
    expect(data.calendarLinks).toMatchObject([{ id: "l1", subCalendars: [{ id: "primary", writable: true }] }]);
    expect(data.timezone).toBe("America/New_York");
    expect(data.defaultEventBufferMin).toBe(10);
    expect(data.hasPersistedWorkingHours).toBe(true);
    expect(data.hasDirectory).toBe(true);
    expect(data.classTerm).toEqual({ id: "t1", code: "26F" });
    expect(getUserRoleInstances).toHaveBeenCalledWith(USER, "t1", request);
    expect(getUserRoles).not.toHaveBeenCalled();
  });

  it("reports a Google failure as ingestionError and still returns the rest of the page", async () => {
    vi.mocked(fetchCalendarEvents).mockRejectedValue(new Error("Google is down"));
    prisma.timeEntry.findMany.mockResolvedValue([
      {
        id: "te1",
        source: "Manual",
        scheduledMeetingId: null,
        sourceEventId: null,
        assignmentType: null,
        roleRefId: null,
        projectId: null,
        date: new Date("2026-11-02"),
        hours: 1,
        note: null,
        startTime: null,
        endTime: null,
        occurrenceStart: null,
        meeting: null,
      },
    ]);
    const data = await run();
    expect(data.ingestionError).toBe("Google is down");
    expect(data.externalEvents).toEqual([]);
    expect(data.timeEntries).toHaveLength(1);
  });

  it("marks a link's calendars unknown when its token cannot be minted", async () => {
    vi.mocked(getValidAccessTokenForLink).mockRejectedValue(new Error("revoked"));
    const data = await run();
    expect(data.calendarLinks[0].subCalendars).toBeNull();
  });

  it("mints no Google token and shows no events while impersonating", async () => {
    vi.mocked(isImpersonating).mockReturnValue(true);
    const data = await run();
    expect(getValidAccessTokenForLink).not.toHaveBeenCalled();
    expect(fetchCalendarEvents).not.toHaveBeenCalled();
    expect(data.externalEvents).toEqual([]);
    expect(data.googleHidden).toBe(true);
  });

  it("drops events from the timesheet mirror calendar", async () => {
    prisma.userAvailabilitySettings.findUnique.mockResolvedValue({
      defaultEventBufferMin: null,
      timesheetGoogleSync: true,
      timesheetCalendarId: "mirror",
    });
    vi.mocked(fetchCalendarEvents).mockResolvedValue([
      event(),
      event({ eventId: "ev2", calendarId: "mirror" }),
    ] as never);
    const data = await run();
    expect(data.externalEvents.map((e: { eventId: string }) => e.eventId)).toEqual(["ev1"]);
  });

  it("starts the database reads while the Google token is still pending", async () => {
    let release!: (t: string) => void;
    vi.mocked(getValidAccessTokenForLink).mockReturnValue(new Promise((r) => (release = r)));
    const pending = run();
    await vi.waitFor(() => expect(getValidAccessTokenForLink).toHaveBeenCalled());
    await vi.waitFor(() => {
      expect(prisma.timeEntry.findMany).toHaveBeenCalled();
      expect(prisma.workingHoursDay.findMany).toHaveBeenCalled();
      expect(resolveTermFilter).toHaveBeenCalled();
    });
    release("tok");
    await expect(pending).resolves.toMatchObject({ currentUserId: USER });
  });

  it("reads logged time in a window bounded at both ends around the visible week", async () => {
    await run();
    const where = prisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe(USER);
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(where.date.lte).toBeInstanceOf(Date);
    expect(where.date.lte.getTime()).toBeGreaterThan(where.date.gte.getTime());
  });
});

describe("loadCalendarData window and cookies", () => {
  const at = (qs: string, headers: Record<string, string> = {}) =>
    loadCalendarData(new Request(`http://localhost/calendar${qs}`, { headers }), {}) as Promise<any>;

  it("anchors a YYYY-MM-DD param to that local calendar day, so the week containing the fall-back DST change is 169 hours", async () => {
    const d = await at("?anchor=2026-11-01");

    expect(d.view).toBe("week");
    expect(d.weekStartIso).toBe("2026-11-01T04:00:00.000Z");
    expect(d.weekEndIso).toBe("2026-11-08T05:00:00.000Z");
    expect(d.rangeStartIso).toBe(d.weekStartIso);
  });

  it("still honours the legacy weekStart param", async () => {
    const d = await at("?weekStart=2026-11-04");

    expect(d.weekStartIso).toBe("2026-11-01T04:00:00.000Z");
  });

  it("prefers anchor over weekStart", async () => {
    const d = await at("?anchor=2026-11-15&weekStart=2026-11-01");

    expect(d.weekStartIso).toBe("2026-11-15T05:00:00.000Z");
  });

  it("falls back to parsing a full ISO instant as the anchor", async () => {
    const d = await at("?anchor=2026-11-04T17:00:00.000Z");

    expect(d.weekStartIso).toBe("2026-11-01T04:00:00.000Z");
  });

  it("ignores an unparseable anchor and shows the current week", async () => {
    const d = await at("?anchor=not-a-date");
    const current = await at("");

    expect(d.weekStartIso).toBe(current.weekStartIso);
  });

  it("narrows the visible range to one day in day view while the week stays whole", async () => {
    const d = await at("?anchor=2026-11-04&view=day");

    expect(d.view).toBe("day");
    expect(d.weekStartIso).toBe("2026-11-01T04:00:00.000Z");
    expect(d.rangeStartIso).toBe("2026-11-04T05:00:00.000Z");
    expect(d.rangeEndIso).toBe("2026-11-05T05:00:00.000Z");
  });

  it("reads the last-used destination and a valid default duration from cookies", async () => {
    const d = await at("", { Cookie: "a=1; dali_event_dest=l1%3Acal1; dali_event_duration=90" });

    expect(d.defaultEventDest).toBe("l1:cal1");
    expect(d.defaultEventDurationMin).toBe(90);
  });

  it.each(["77", "abc", ""])("falls back to 60 minutes for a duration cookie of %j", async (v) => {
    const d = await at("", { Cookie: `dali_event_duration=${v}` });

    expect(d.defaultEventDurationMin).toBe(60);
    expect(d.defaultEventDest).toBeNull();
  });
});
