// meetingsForExternalEvents used to admit only a meeting's organizer/
// participants (plus any lab member on the general calendar). An organizer
// Google never listed as a DALI-roster guest could then open an event Google
// says is theirs and find no note affordance. These cover the fix: a viewer
// Google reports as on the event reaches the same canOpenNote the roster
// would have given them, and the access query actually asks for that event.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/general-calendar", () => ({
  isGeneralCalendarEvent: vi.fn(() => false),
}));

import { prisma } from "~/lib/db.server";
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

  it.each([true, false])("reports the stored isCoreMeeting column (%s)", async (isCoreMeeting) => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([{ ...baseMeeting(), isCoreMeeting, notebookId: "nb1" }]);

    const result = await meetingsForExternalEvents([baseEvent()], "viewer-1", false, false);

    expect(result.get("evt-1")).toMatchObject({ isCoreMeeting });
  });

  describe("split series", () => {
    const base = "6b1uc1q7omn5duodshtuoohpts";
    const split = `${base}_R20260928T130000`;
    const splitEvent = (over: Partial<CalendarEvent> = {}) =>
      baseEvent({
        eventId: `${base}_20261019T130000Z`,
        recurringEventId: split,
        iCalUID: `${split}@google.com`,
        startIso: "2026-10-19T13:00:00.000Z",
        endIso: "2026-10-19T14:00:00.000Z",
        ...over,
      });
    const parent = () => ({
      ...baseMeeting(),
      externalEventId: base,
      iCalUID: `${base}@google.com`,
      selectedAt: new Date("2026-09-14T13:00:00.000Z"),
      recurrenceRule: "FREQ=WEEKLY",
      notePages: [],
    });

    function whereOf() {
      return mockPrisma.scheduledMeeting.findMany.mock.calls[0][0].where as {
        AND: [{ OR: unknown[] }, { OR: unknown[] }];
      };
    }

    it("queries for the base ids and UIDs of a split event", async () => {
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
      await meetingsForExternalEvents([splitEvent()], "viewer-1", false, false);

      const [identity] = whereOf().AND;
      expect(identity.OR).toEqual([
        { externalEventId: { in: expect.arrayContaining([base, split, `${base}_20261019T130000Z`]) } },
        { iCalUID: { in: expect.arrayContaining([`${split}@google.com`, `${base}@google.com`]) } },
      ]);
    });

    it("resolves a split instance to the parent lineage", async () => {
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([parent()]);
      const event = splitEvent({ responseStatus: "accepted" });

      const result = await meetingsForExternalEvents([event], "viewer-1", false, false);

      expect(result.get(event.eventId)).toMatchObject({ meetingId: "m1" });
    });

    it("prefers an exact meeting for the split over the parent", async () => {
      const child = { ...baseMeeting(), id: "m2", externalEventId: split, iCalUID: `${split}@google.com` };
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([parent(), child]);
      const event = splitEvent({ responseStatus: "accepted" });

      const result = await meetingsForExternalEvents([event], "viewer-1", false, false);

      expect(result.get(event.eventId)).toMatchObject({ meetingId: "m2" });
    });

    it("never writes the split's UID onto the parent row", async () => {
      const row = { ...parent(), iCalUID: null };
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([row]);

      await meetingsForExternalEvents([splitEvent({ responseStatus: "accepted" })], "viewer-1", false, false);

      expect(mockPrisma.scheduledMeeting.update).not.toHaveBeenCalled();
    });

    it("still heals the UID when the event matches the parent exactly", async () => {
      const row = { ...parent(), iCalUID: null };
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([row]);
      const exact = baseEvent({ eventId: `${base}_20261012T130000Z`, recurringEventId: base, iCalUID: `${base}@google.com` });

      await meetingsForExternalEvents([exact], "viewer-1", false, false);

      expect(mockPrisma.scheduledMeeting.update).toHaveBeenCalledWith({
        where: { id: "m1" },
        data: { iCalUID: `${base}@google.com` },
      });
    });

    it("admits by iCalUID, with base forms, for events Google puts the viewer on", async () => {
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
      await meetingsForExternalEvents([splitEvent({ responseStatus: "accepted" })], "viewer-1", false, false);

      const access = whereOf().AND[1].OR;
      expect(access).toEqual(
        expect.arrayContaining([
          { externalEventId: { in: expect.arrayContaining([base, split]) } },
          { iCalUID: { in: expect.arrayContaining([`${split}@google.com`, `${base}@google.com`]) } },
        ]),
      );
    });

    it("admits by iCalUID for lab-wide events", async () => {
      const { isGeneralCalendarEvent } = await import("~/lib/general-calendar");
      vi.mocked(isGeneralCalendarEvent).mockReturnValueOnce(true);
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);

      await meetingsForExternalEvents([splitEvent()], "viewer-1", false, true);

      expect(whereOf().AND[1].OR).toEqual(
        expect.arrayContaining([{ iCalUID: { in: expect.arrayContaining([`${base}@google.com`]) } }]),
      );
    });

    it("adds no iCalUID admission for events the viewer is not on", async () => {
      mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
      await meetingsForExternalEvents([splitEvent()], "viewer-1", false, false);

      expect(whereOf().AND[1].OR).toEqual([
        { organizerId: "viewer-1" },
        { participantUserIds: { has: "viewer-1" } },
      ]);
    });
  });
});
