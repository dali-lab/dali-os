import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    userAvailabilitySettings: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    workingHoursDay: { findMany: vi.fn() },
    userCalendarLink: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn(),
  isCore: vi.fn(),
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/google-calendar", () => ({
  getValidAccessTokenForLink: vi.fn(),
  listCalendarsForLink: vi.fn(),
}));
vi.mock("~/calendar/routes/calendar.server", () => ({
  buildCalendarLinkDTO: vi.fn(),
  loadParticipantOptions: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth, isNonMember } from "~/lib/auth";
import { canViewForms, isCore } from "~/lib/roles";
import { getValidAccessTokenForLink, listCalendarsForLink } from "~/lib/google-calendar";
import { buildCalendarLinkDTO, loadParticipantOptions } from "~/calendar/routes/calendar.server";
import { DEFAULT_BUFFER_MIN } from "../calendar-defaults";
import { loadSchedulingData } from "../scheduling-data.server";

const req = new Request("http://os.test/api/scheduling-data");

const db = prisma as unknown as {
  userAvailabilitySettings: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  workingHoursDay: { findMany: ReturnType<typeof vi.fn> };
  userCalendarLink: { findMany: ReturnType<typeof vi.fn> };
};

const wh = (dayOfWeek: number, startMinute: number, endMinute: number, over: Record<string, unknown> = {}) => ({
  id: `wh-${dayOfWeek}-${startMinute}`,
  dayOfWeek,
  startMinute,
  endMinute,
  location: "InPerson",
  enabled: true,
  ...over,
});

async function load() {
  const r = await loadSchedulingData(req);
  if (!r.ok) throw new Error("expected ok");
  return r.data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(canViewForms).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(loadParticipantOptions).mockResolvedValue({ groups: [], users: [], mentorPairs: [] } as never);
  vi.mocked(buildCalendarLinkDTO).mockImplementation((async (l: { id: string }) => ({ id: l.id })) as never);
  db.userAvailabilitySettings.findUnique.mockResolvedValue(null);
  db.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });
  db.workingHoursDay.findMany.mockResolvedValue([]);
  db.userCalendarLink.findMany.mockResolvedValue([]);
});

describe("loadSchedulingData", () => {
  it("returns the auth response when signed out", async () => {
    const response = new Response("no", { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response } as never);

    expect(await loadSchedulingData(req)).toEqual({ ok: false, response });
  });

  it("sends a non-member to the portal without loading anything", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);

    const r = await loadSchedulingData(req);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(302);
      expect(r.response.headers.get("location")).toBe("/portal");
    }
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("defaults to Mon-Fri 9-5 working hours and the default buffer when nothing is stored", async () => {
    const data = await load();

    expect(data.hasPersistedWorkingHours).toBe(false);
    expect(data.workingHours.map((d) => d.segments.length)).toEqual([0, 1, 1, 1, 1, 1, 0]);
    expect(data.defaultEventBufferMin).toBe(DEFAULT_BUFFER_MIN);
    expect(data.timezone).toBe("America/New_York");
  });

  it("uses persisted hours: sorted per day, and an unlisted day is empty rather than defaulted", async () => {
    db.workingHoursDay.findMany.mockResolvedValue([wh(2, 780, 900), wh(2, 540, 660)]);

    const data = await load();

    expect(data.hasPersistedWorkingHours).toBe(true);
    expect(data.workingHours[2]!.segments.map((s) => s.startMinute)).toEqual([540, 780]);
    expect(data.workingHours[1]!.segments).toEqual([]);
    expect(data.workingHours[3]!.segments).toEqual([]);
  });

  it("ignores disabled and inverted segments but still counts them as persisted", async () => {
    db.workingHoursDay.findMany.mockResolvedValue([
      wh(1, 0, 1, { enabled: false }),
      wh(3, 600, 600),
      wh(4, 700, 600),
    ]);

    const data = await load();

    expect(data.hasPersistedWorkingHours).toBe(true);
    expect(data.workingHours.every((d) => d.segments.length === 0)).toBe(true);
  });

  it("reads the buffer and timesheet calendar from the user's settings", async () => {
    db.userAvailabilitySettings.findUnique.mockResolvedValue({
      defaultEventBufferMin: 30,
      timesheetCalendarId: "ts-cal",
    });
    db.userCalendarLink.findMany.mockResolvedValue([{ id: "l1", provider: "Google" }]);
    vi.mocked(getValidAccessTokenForLink).mockResolvedValue("tok");
    vi.mocked(listCalendarsForLink).mockResolvedValue([] as never);

    const data = await load();

    expect(data.defaultEventBufferMin).toBe(30);
    expect(vi.mocked(buildCalendarLinkDTO).mock.calls[0]![2]).toBe("ts-cal");
  });

  it("falls back to the lab time zone when the user's is unusable", async () => {
    db.user.findUnique.mockResolvedValue({ timeZone: "Not/AZone" });

    expect((await load()).timezone).toBe("America/New_York");
  });

  it("prefetches each Google link's calendar list once and hands it to the DTO builder", async () => {
    const lists = [{ id: "cal-1" }];
    db.userCalendarLink.findMany.mockResolvedValue([
      { id: "g1", provider: "Google" },
      { id: "o1", provider: "Outlook" },
    ]);
    vi.mocked(getValidAccessTokenForLink).mockResolvedValue("tok");
    vi.mocked(listCalendarsForLink).mockResolvedValue(lists as never);

    const data = await load();

    expect(getValidAccessTokenForLink).toHaveBeenCalledTimes(1);
    expect(listCalendarsForLink).toHaveBeenCalledWith("g1", "tok");
    const prefetched = vi.mocked(buildCalendarLinkDTO).mock.calls[0]![1] as Map<string, unknown>;
    expect(prefetched.get("g1")).toBe(lists);
    expect(prefetched.has("o1")).toBe(false);
    expect(data.calendarLinks).toEqual([{ id: "g1" }, { id: "o1" }]);
  });

  it("marks a link's list undefined, instead of failing the load, when Google errors", async () => {
    db.userCalendarLink.findMany.mockResolvedValue([{ id: "g1", provider: "Google" }]);
    vi.mocked(getValidAccessTokenForLink).mockRejectedValue(new Error("token revoked"));

    const data = await load();

    const prefetched = vi.mocked(buildCalendarLinkDTO).mock.calls[0]![1] as Map<string, unknown>;
    expect(prefetched.has("g1")).toBe(true);
    expect(prefetched.get("g1")).toBeUndefined();
    expect(data.calendarLinks).toEqual([{ id: "g1" }]);
  });

  it("passes the forms, core and participant lookups through, with no timesheet roles", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(loadParticipantOptions).mockResolvedValue({
      groups: [{ id: "g" }],
      users: [{ id: "u" }],
      mentorPairs: [{ id: "p" }],
    } as never);

    const data = await load();

    expect(data).toMatchObject({
      currentUserId: "u1",
      canSetSelfCheckIn: true,
      canMarkCoreMeeting: true,
      groups: [{ id: "g" }],
      users: [{ id: "u" }],
      mentorPairs: [{ id: "p" }],
      myRoles: [],
      defaultEventDest: null,
    });
    expect(data.weekStartIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
  });
});
