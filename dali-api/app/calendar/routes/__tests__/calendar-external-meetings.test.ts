// meetingsForExternalEvents used to admit only a meeting's organizer/
// participants (plus any lab member on the general calendar). An organizer
// Google never listed as a DALI-roster guest could then open an event Google
// says is theirs and find no note affordance. These cover the fix: a viewer
// Google reports as on the event reaches the same canOpenNote the roster
// would have given them, and the access query actually asks for that event.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/general-calendar", () => ({
  isGeneralCalendarEvent: vi.fn(() => false),
}));

import { prisma } from "~/lib/db";
import { meetingsForExternalEvents } from "~/calendar/routes/calendar.server";
import type { CalendarEvent } from "~/lib/google-calendar";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function baseEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    eventId: "evt-1",
    calendarId: "cal-x",
    linkId: "link-1",
    startIso: "2026-10-01T15:00:00.000Z",
    endIso: "2026-10-01T16:00:00.000Z",
    allDay: false,
    title: "Sync",
    writable: true,
    ...over,
  };
}

function baseMeeting() {
  return {
    id: "m1",
    organizerId: "someone-else",
    externalEventId: "evt-1",
    iCalUID: null,
    isCoreMeeting: false,
    meetingType: "Team",
    participantUserIds: [] as string[],
    selectedAt: new Date("2026-10-01T15:00:00.000Z"),
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    durationMinutes: 60,
    recurrenceRule: null,
    exceptions: [],
    notePages: [{ id: "note-1", meetingOccurrenceStart: new Date("2026-10-01T15:00:00.000Z") }],
    whiteboardPage: null,
    timeEntries: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.scheduledMeeting.update.mockResolvedValue({});
});

describe("meetingsForExternalEvents", () => {
  it("lets a non-participant viewer Google says is on the event open the note, and queries for that event", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([baseMeeting()]);
    const event = baseEvent({ responseStatus: "accepted" });

    const result = await meetingsForExternalEvents([event], "viewer-1", false, false);

    expect(result.get("evt-1")).toMatchObject({ meetingId: "m1", hasType: true, canOpenNote: true });
    const where = mockPrisma.scheduledMeeting.findMany.mock.calls[0][0].where as {
      AND: [unknown, { OR: unknown[] }];
    };
    expect(where.AND[1].OR).toEqual(
      expect.arrayContaining([{ externalEventId: { in: ["evt-1"] } }]),
    );
  });

  it("does not let a viewer with no roster spot and no Google presence open the note", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([baseMeeting()]);
    const event = baseEvent();

    const result = await meetingsForExternalEvents([event], "viewer-1", false, false);

    expect(result.get("evt-1")).toMatchObject({ canOpenNote: false });
    const where = mockPrisma.scheduledMeeting.findMany.mock.calls[0][0].where as {
      AND: [unknown, { OR: unknown[] }];
    };
    expect(where.AND[1].OR).toEqual([
      { organizerId: "viewer-1" },
      { participantUserIds: { has: "viewer-1" } },
    ]);
  });
});
