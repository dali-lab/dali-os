import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (hoisted so vi.mock factory ordering is respected) ─────────────────

const prismaMock = vi.hoisted(() => ({
  userAvailabilitySettings: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  userCalendarLink: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  timeEntry: {
    update: vi.fn(),
  },
}));

const googleCalendarMock = vi.hoisted(() => ({
  getOrCreateNamedCalendar: vi.fn(),
  subscribeCalendarForLink: vi.fn(),
  listCalendarsForLink: vi.fn(),
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
}));

const rolesMock = vi.hoisted(() => ({
  getRoleLabel: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ prisma: prismaMock }));
vi.mock("~/lib/google-calendar", () => googleCalendarMock);
vi.mock("~/lib/roles", () => rolesMock);
// APPLICATION_TZ is a plain string export — keep the real value
vi.mock("~/lib/timezone", () => ({ APPLICATION_TZ: "America/New_York" }));

import {
  getUserTimesheetSyncEnabled,
  setUserTimesheetSync,
  syncTimeEntryToGoogle,
  removeTimeEntryFromGoogle,
  type TimesheetEntryInput,
} from "~/lib/timesheet-mirror.server";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<TimesheetEntryInput> = {}): TimesheetEntryInput {
  return {
    id: "entry-1",
    userId: "user-1",
    assignmentType: "Project",
    roleRefId: "pa-1",
    note: "Sprint work",
    startTime: new Date("2026-08-28T09:00:00Z"),
    endTime: new Date("2026-08-28T11:00:00Z"),
    googleTimesheetEventId: null,
    googleTimesheetLinkId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: upsert and timeEntry.update succeed silently
  prismaMock.userAvailabilitySettings.upsert.mockResolvedValue({});
  prismaMock.timeEntry.update.mockResolvedValue({});
  // Default: listCalendarsForLink returns empty (primary fallback)
  googleCalendarMock.listCalendarsForLink.mockResolvedValue([]);
  // Default: subscribe is a no-op
  googleCalendarMock.subscribeCalendarForLink.mockResolvedValue(undefined);
  // Default: userCalendarLink.update succeeds
  prismaMock.userCalendarLink.update.mockResolvedValue({});
  // Default: userCalendarLink.findUnique returns no subCalendarIds
  prismaMock.userCalendarLink.findUnique.mockResolvedValue({ subCalendarIds: [] });
  // Default: role label resolves
  rolesMock.getRoleLabel.mockResolvedValue("Hacksmith (P2)");
});

// ── getUserTimesheetSyncEnabled ──────────────────────────────────────────────

describe("getUserTimesheetSyncEnabled", () => {
  it("returns false when no settings row exists", async () => {
    prismaMock.userAvailabilitySettings.findUnique.mockResolvedValue(null);
    expect(await getUserTimesheetSyncEnabled("user-1")).toBe(false);
  });

  it("returns the stored flag when a row exists", async () => {
    prismaMock.userAvailabilitySettings.findUnique.mockResolvedValue({
      timesheetGoogleSync: true,
    });
    expect(await getUserTimesheetSyncEnabled("user-1")).toBe(true);
  });

  it("returns false when flag is explicitly false", async () => {
    prismaMock.userAvailabilitySettings.findUnique.mockResolvedValue({
      timesheetGoogleSync: false,
    });
    expect(await getUserTimesheetSyncEnabled("user-1")).toBe(false);
  });
});

// ── setUserTimesheetSync ─────────────────────────────────────────────────────

describe("setUserTimesheetSync — disable", () => {
  it("clears the flag without touching Google", async () => {
    const result = await setUserTimesheetSync("user-1", false);
    expect(result).toEqual({ ok: true });
    expect(prismaMock.userAvailabilitySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { timesheetGoogleSync: false } }),
    );
    expect(googleCalendarMock.getOrCreateNamedCalendar).not.toHaveBeenCalled();
  });
});

describe("setUserTimesheetSync — enable, no DALI link", () => {
  it("returns needsDaliLink when no matching Google link exists", async () => {
    prismaMock.userCalendarLink.findFirst.mockResolvedValue(null);
    const result = await setUserTimesheetSync("user-1", true);
    expect(result).toEqual({ ok: false, reason: "needsDaliLink" });
    expect(prismaMock.userAvailabilitySettings.upsert).not.toHaveBeenCalled();
    expect(googleCalendarMock.getOrCreateNamedCalendar).not.toHaveBeenCalled();
  });
});

describe("setUserTimesheetSync — enable, DALI link present", () => {
  beforeEach(() => {
    prismaMock.userCalendarLink.findFirst.mockResolvedValue({ id: "link-dali" });
    googleCalendarMock.getOrCreateNamedCalendar.mockResolvedValue("cal-ts-id");
  });

  it("creates the calendar once and persists ids", async () => {
    const result = await setUserTimesheetSync("user-1", true);
    expect(result).toEqual({ ok: true });
    expect(googleCalendarMock.getOrCreateNamedCalendar).toHaveBeenCalledWith(
      "link-dali",
      "DALI Timesheet",
    );
    expect(prismaMock.userAvailabilitySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          timesheetGoogleSync: true,
          timesheetCalendarLinkId: "link-dali",
          timesheetCalendarId: "cal-ts-id",
        }),
      }),
    );
  });

  it("calls ensureCalendarVisible (subscribe + subCalendarIds update)", async () => {
    await setUserTimesheetSync("user-1", true);
    expect(googleCalendarMock.subscribeCalendarForLink).toHaveBeenCalledWith("link-dali", "cal-ts-id");
    expect(prismaMock.userCalendarLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-dali" },
        data: expect.objectContaining({ subCalendarIds: expect.arrayContaining(["cal-ts-id"]) }),
      }),
    );
  });

  it("returns { ok: false, reason: 'error' } when getOrCreateNamedCalendar throws", async () => {
    googleCalendarMock.getOrCreateNamedCalendar.mockRejectedValue(new Error("quota exceeded"));
    const result = await setUserTimesheetSync("user-1", true);
    expect(result).toEqual({ ok: false, reason: "error", message: "quota exceeded" });
    expect(prismaMock.userAvailabilitySettings.upsert).not.toHaveBeenCalled();
  });
});

// ── syncTimeEntryToGoogle ────────────────────────────────────────────────────

describe("syncTimeEntryToGoogle — sync disabled", () => {
  it("makes no Google calls when timesheetGoogleSync is false", async () => {
    prismaMock.userAvailabilitySettings.findUnique.mockResolvedValue({
      timesheetGoogleSync: false,
    });
    await syncTimeEntryToGoogle(makeEntry());
    expect(googleCalendarMock.createGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(googleCalendarMock.patchGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("makes no Google calls when settings row is absent", async () => {
    prismaMock.userAvailabilitySettings.findUnique.mockResolvedValue(null);
    await syncTimeEntryToGoogle(makeEntry());
    expect(googleCalendarMock.createGoogleCalendarEvent).not.toHaveBeenCalled();
  });
});

describe("syncTimeEntryToGoogle — sync enabled", () => {
  const settings = {
    timesheetGoogleSync: true,
    timesheetCalendarLinkId: "link-dali",
    timesheetCalendarId: "cal-ts-id",
  };

  beforeEach(() => {
    prismaMock.userAvailabilitySettings.findUnique.mockResolvedValue(settings);
    googleCalendarMock.createGoogleCalendarEvent.mockResolvedValue({
      eventId: "gcal-event-1",
      htmlLink: null,
    });
  });

  it("no-ops for entries without startTime/endTime", async () => {
    await syncTimeEntryToGoogle(makeEntry({ startTime: null, endTime: null }));
    expect(googleCalendarMock.createGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("no-ops for entries without a role attribution", async () => {
    await syncTimeEntryToGoogle(makeEntry({ assignmentType: null, roleRefId: null }));
    expect(googleCalendarMock.createGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("creates a Google event for a timed work entry and persists googleTimesheetEventId", async () => {
    await syncTimeEntryToGoogle(makeEntry());

    expect(googleCalendarMock.createGoogleCalendarEvent).toHaveBeenCalledOnce();
    const call = googleCalendarMock.createGoogleCalendarEvent.mock.calls[0][0];
    expect(call.linkId).toBe("link-dali");
    expect(call.calendarId).toBe("cal-ts-id");
    expect(call.summary).toBe("Hacksmith (P2)"); // resolved role label
    expect(call.description).toBe("Sprint work");
    expect(call.attendees).toEqual([]);

    expect(prismaMock.timeEntry.update).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: {
        googleTimesheetEventId: "gcal-event-1",
        googleTimesheetLinkId: "link-dali",
      },
    });
  });

  it("patches the event when googleTimesheetEventId is already set (update path)", async () => {
    const entry = makeEntry({
      googleTimesheetEventId: "gcal-event-existing",
      googleTimesheetLinkId: "link-dali",
    });
    await syncTimeEntryToGoogle(entry);

    expect(googleCalendarMock.patchGoogleCalendarEvent).toHaveBeenCalledOnce();
    const call = googleCalendarMock.patchGoogleCalendarEvent.mock.calls[0][0];
    expect(call.eventId).toBe("gcal-event-existing");
    expect(call.calendarId).toBe("cal-ts-id");

    // Should NOT create a new event or update the DB
    expect(googleCalendarMock.createGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(prismaMock.timeEntry.update).not.toHaveBeenCalled();
  });

  it("swallows a Google error without throwing (best-effort)", async () => {
    googleCalendarMock.createGoogleCalendarEvent.mockRejectedValue(
      new Error("Google API quota exceeded"),
    );
    // Must not throw
    await expect(syncTimeEntryToGoogle(makeEntry())).resolves.toBeUndefined();
    // Postgres update was NOT attempted after a failed create
    expect(prismaMock.timeEntry.update).not.toHaveBeenCalled();
  });

  it("uses 'Work' as fallback summary when getRoleLabel returns null", async () => {
    rolesMock.getRoleLabel.mockResolvedValue(null);
    await syncTimeEntryToGoogle(makeEntry());
    const call = googleCalendarMock.createGoogleCalendarEvent.mock.calls[0][0];
    expect(call.summary).toBe("Work");
  });
});

// ── removeTimeEntryFromGoogle ────────────────────────────────────────────────

describe("removeTimeEntryFromGoogle", () => {
  beforeEach(() => {
    prismaMock.userAvailabilitySettings.findUnique.mockResolvedValue({
      timesheetCalendarId: "cal-ts-id",
    });
    googleCalendarMock.deleteGoogleCalendarEvent.mockResolvedValue(undefined);
  });

  it("no-ops when googleTimesheetEventId is null", async () => {
    await removeTimeEntryFromGoogle(makeEntry({ googleTimesheetEventId: null }));
    expect(googleCalendarMock.deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("no-ops when googleTimesheetLinkId is null", async () => {
    await removeTimeEntryFromGoogle(
      makeEntry({ googleTimesheetEventId: "gcal-event-1", googleTimesheetLinkId: null }),
    );
    expect(googleCalendarMock.deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("deletes the mirror event when both ids are set", async () => {
    const entry = makeEntry({
      googleTimesheetEventId: "gcal-event-1",
      googleTimesheetLinkId: "link-dali",
    });
    await removeTimeEntryFromGoogle(entry);

    expect(googleCalendarMock.deleteGoogleCalendarEvent).toHaveBeenCalledWith({
      linkId: "link-dali",
      calendarId: "cal-ts-id",
      eventId: "gcal-event-1",
    });
  });

  it("swallows a Google delete error without throwing (best-effort)", async () => {
    googleCalendarMock.deleteGoogleCalendarEvent.mockRejectedValue(new Error("403 Forbidden"));
    const entry = makeEntry({
      googleTimesheetEventId: "gcal-event-1",
      googleTimesheetLinkId: "link-dali",
    });
    await expect(removeTimeEntryFromGoogle(entry)).resolves.toBeUndefined();
  });
});
