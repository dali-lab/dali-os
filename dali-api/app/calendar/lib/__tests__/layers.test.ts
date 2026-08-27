import { describe, it, expect } from "vitest";
import {
  buildGridDays,
  buildBlocksLayer,
  buildExternalLayer,
  buildMeetingsLayer,
  buildClassesLayer,
  buildAllDayItems,
  buildLoggedTimeLayer,
  buildLoggedSourceIndex,
  mergeLayers,
  externalCalendarLegend,
  perCalendarLegend,
} from "../layers";
import { EVENT_CORAL } from "../event-block";
import type { LoaderData } from "../types";

// Minimal loader fixture — only the fields the builders read. Timezone UTC keeps
// the hour math trivial (zonedDayStartUtc(y,m,d,"UTC") === Date.UTC(y,m,d)).
function fixture(overrides: Partial<LoaderData> = {}): LoaderData {
  return {
    timezone: "UTC",
    externalEvents: [],
    manualBlocks: [],
    meetingInvites: [],
    timeEntries: [],
    calendarLinks: [],
    myRoles: [],
    canMarkCoreMeeting: false,
    ...overrides,
  } as unknown as LoaderData;
}

const WEEK = "2026-08-16T00:00:00.000Z"; // Sunday

describe("buildGridDays", () => {
  it("builds N consecutive days from the anchor with correct weekdays", () => {
    const days = buildGridDays(WEEK, 7);
    expect(days).toHaveLength(7);
    expect(days[0].dayOfWeek).toBe(0); // Sunday
    expect(days[0].num).toBe(16);
    expect(days[6].dayOfWeek).toBe(6); // Saturday
    expect(days[6].num).toBe(22);
  });

  it("supports a single day (day view)", () => {
    expect(buildGridDays("2026-08-18T00:00:00.000Z", 1)).toHaveLength(1);
  });
});

describe("buildBlocksLayer", () => {
  it("places a manual block in the right column at the right hour", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      manualBlocks: [
        {
          id: "b1",
          title: "Focus",
          startTime: "2026-08-17T10:00:00.000Z", // Monday 10:00
          endTime: "2026-08-17T11:30:00.000Z",
          recurrenceRule: null,
          isWork: false,
          assignmentType: null,
          roleRefId: null,
        },
      ],
    });
    const layer = buildBlocksLayer(data, days);
    expect(layer[1]).toHaveLength(1); // Monday = index 1
    expect(layer[1][0]).toMatchObject({ startHour: 10, duration: 1.5, label: "Focus", className: EVENT_CORAL });
  });

  it("drops blocks outside the visible range", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      manualBlocks: [
        {
          id: "b2",
          title: "Next week",
          startTime: "2026-08-30T10:00:00.000Z",
          endTime: "2026-08-30T11:00:00.000Z",
          recurrenceRule: null,
          isWork: false,
          assignmentType: null,
          roleRefId: null,
        },
      ],
    });
    expect(Object.keys(buildBlocksLayer(data, days))).toHaveLength(0);
  });
});

describe("buildExternalLayer", () => {
  it("uses the calendar colour when present, else the coral fallback", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      externalEvents: [
        { startIso: "2026-08-16T09:00:00.000Z", endIso: "2026-08-16T10:00:00.000Z", title: "Colored", color: "#123456" },
        { startIso: "2026-08-16T12:00:00.000Z", endIso: "2026-08-16T13:00:00.000Z", title: "Plain", color: null },
      ] as LoaderData["externalEvents"],
    });
    const layer = buildExternalLayer(data, days);
    expect(layer[0]).toHaveLength(2);
    expect(layer[0][0]).toMatchObject({ label: "Colored", bgColor: "#123456" });
    expect(layer[0][1]).toMatchObject({ label: "Plain", className: EVENT_CORAL });
  });

  it("hides events from calendars in hiddenCalendarIds", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      externalEvents: [
        { startIso: "2026-08-16T09:00:00.000Z", endIso: "2026-08-16T10:00:00.000Z", title: "Personal", color: "#111", calendarId: "cal-a" },
        { startIso: "2026-08-16T12:00:00.000Z", endIso: "2026-08-16T13:00:00.000Z", title: "Class", color: "#222", calendarId: "cal-b" },
      ] as LoaderData["externalEvents"],
    });
    const layer = buildExternalLayer(data, days, new Set(["cal-a"]));
    expect(layer[0]).toHaveLength(1);
    expect(layer[0][0].label).toBe("Class");
  });
});

describe("perCalendarLegend", () => {
  it("lists enabled sub-calendars by id (not deduped by colour)", () => {
    const data = fixture({
      calendarLinks: [
        {
          id: "l1",
          subCalendars: [
            { id: "c1", summary: "Personal", color: "#aaa", enabled: true, primary: true },
            { id: "c2", summary: "Classes", color: "#aaa", enabled: true, primary: false },
            { id: "c3", summary: "Off", color: "#bbb", enabled: false, primary: false },
          ],
        },
      ] as unknown as LoaderData["calendarLinks"],
    });
    const rows = perCalendarLegend(data);
    expect(rows).toEqual([
      { id: "c1", label: "Personal", color: "#aaa" },
      { id: "c2", label: "Classes", color: "#aaa" }, // same colour, still separate
    ]);
  });
});

describe("buildMeetingsLayer", () => {
  it("carries meeting metadata and reflects timesheet state", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      canMarkCoreMeeting: true,
      timeEntries: [{ scheduledMeetingId: "m1" }] as unknown as LoaderData["timeEntries"],
      meetingInvites: [
        {
          notificationId: "n1",
          meetingId: "m1",
          title: "Standup",
          startIso: "2026-08-18T10:00:00.000Z",
          endIso: "2026-08-18T10:30:00.000Z",
          rsvp: "Accepted",
          notePageId: null,
          organizerName: "Sara",
          attendees: [],
          isCoreMeeting: false,
        },
      ],
    });
    const layer = buildMeetingsLayer(data, days);
    const block = layer[2][0]; // Tuesday
    expect(block).toMatchObject({ label: "Standup", startHour: 10, duration: 0.5 });
    expect(block.meeting).toMatchObject({ meetingId: "m1", onTimesheet: true, canMarkCoreMeeting: true });
  });
});

describe("buildLoggedTimeLayer", () => {
  it("places timed entries and honours excluded roles", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      timeEntries: [
        {
          id: "t1",
          source: "Manual",
          scheduledMeetingId: null,
          manualBlockId: null,
          meetingNotePageId: null,
          assignmentType: null,
          roleRefId: null,
          projectId: null,
          date: "2026-08-19",
          hours: 2,
          note: "Design",
          startTime: "2026-08-19T13:00:00.000Z",
          endTime: "2026-08-19T15:00:00.000Z",
        },
      ] as LoaderData["timeEntries"],
    });
    const layer = buildLoggedTimeLayer(data, days);
    expect(layer[3][0]).toMatchObject({ label: "Design", startHour: 13, duration: 2 });

    // Excluding the unassigned bucket (this entry's role) drops it.
    const filtered = buildLoggedTimeLayer(data, days, { excludedRoleKeys: new Set(["unassigned"]) });
    expect(Object.keys(filtered)).toHaveLength(0);
  });
});

describe("logged-time de-duplication", () => {
  const days = buildGridDays(WEEK, 7); // 2026-08-18 is Tuesday = index 2

  function loggedFixture() {
    return fixture({
      meetingInvites: [
        {
          notificationId: "n1",
          meetingId: "m1",
          title: "Standup",
          startIso: "2026-08-18T10:00:00.000Z",
          endIso: "2026-08-18T10:30:00.000Z",
          rsvp: "Accepted",
          notePageId: null,
          organizerName: "Sara",
          attendees: [],
          isCoreMeeting: false,
        },
      ] as unknown as LoaderData["meetingInvites"],
      manualBlocks: [
        {
          id: "b1",
          title: "Deep work",
          startTime: "2026-08-18T13:00:00.000Z",
          endTime: "2026-08-18T15:00:00.000Z",
          recurrenceRule: null,
          isWork: true,
          assignmentType: null,
          roleRefId: null,
        },
      ] as unknown as LoaderData["manualBlocks"],
      timeEntries: [
        {
          id: "t-m", source: "Meeting", scheduledMeetingId: "m1", manualBlockId: null, meetingNotePageId: null,
          assignmentType: null, roleRefId: null, projectId: null, date: "2026-08-18", hours: 0.5, note: null,
          startTime: "2026-08-18T10:00:00.000Z", endTime: "2026-08-18T10:30:00.000Z",
        },
        {
          id: "t-b", source: "Block", scheduledMeetingId: null, manualBlockId: "b1", meetingNotePageId: null,
          assignmentType: null, roleRefId: null, projectId: null, date: "2026-08-18", hours: 2, note: null,
          startTime: "2026-08-18T13:00:00.000Z", endTime: "2026-08-18T15:00:00.000Z",
        },
        {
          id: "t-s", source: "Manual", scheduledMeetingId: null, manualBlockId: null, meetingNotePageId: null,
          assignmentType: null, roleRefId: null, projectId: null, date: "2026-08-18", hours: 1, note: "Email",
          startTime: "2026-08-18T16:00:00.000Z", endTime: "2026-08-18T17:00:00.000Z",
        },
      ] as LoaderData["timeEntries"],
    });
  }

  it("indexes sourced logged hours by meeting and block", () => {
    const idx = buildLoggedSourceIndex(loggedFixture());
    expect(idx.byMeeting.get("m1")?.hours).toBe(0.5);
    expect(idx.byBlock.get("b1")?.hours).toBe(2);
  });

  it("annotates the source block with a logged accent instead of duplicating", () => {
    const data = loggedFixture();
    const idx = buildLoggedSourceIndex(data);
    expect(buildMeetingsLayer(data, days, idx.byMeeting)[2][0].loggedAccent).toMatchObject({ hours: 0.5 });
    expect(buildBlocksLayer(data, days, idx.byBlock)[2][0].loggedAccent).toMatchObject({ hours: 2 });
  });

  it("indexes nothing for a role that's filtered out", () => {
    const idx = buildLoggedSourceIndex(loggedFixture(), new Set(["unassigned"]));
    expect(idx.byMeeting.size).toBe(0);
    expect(idx.byBlock.size).toBe(0);
  });

  it("suppresses sourced entries whose source layer is visible, keeps standalone", () => {
    const logged = buildLoggedTimeLayer(loggedFixture(), days, {
      suppressSourced: { meetings: true, blocks: true },
    });
    expect((logged[2] ?? []).map((b) => b.label)).toEqual(["Email"]);
  });

  it("keeps a sourced entry when its source layer is hidden", () => {
    const logged = buildLoggedTimeLayer(loggedFixture(), days, {
      suppressSourced: { meetings: false, blocks: true },
    });
    const labels = (logged[2] ?? []).map((b) => b.label);
    expect(labels).toContain("Meeting"); // meeting hidden → its logged block still draws
    expect(labels).toContain("Email");
    expect(labels).not.toContain("Time entry"); // block-sourced suppressed
  });
});

describe("buildAllDayItems (Google CRUD)", () => {
  it("buckets all-day events into every day they cover (end exclusive) and skips timed", () => {
    const days = buildGridDays(WEEK, 7); // Sun 8/16 … Sat 8/22
    const data = fixture({
      externalEvents: [
        // 2-day all-day event Mon–Tue (end exclusive Wed).
        { startIso: "2026-08-17T00:00:00.000Z", endIso: "2026-08-19T00:00:00.000Z", title: "Trip", color: "#123", allDay: true, calendarId: "c1", eventId: "e1", writable: true },
        // A timed event — must NOT appear in the all-day band.
        { startIso: "2026-08-17T14:00:00.000Z", endIso: "2026-08-17T15:00:00.000Z", title: "Timed", color: null },
      ] as LoaderData["externalEvents"],
    });
    const band = buildAllDayItems(data, days);
    expect(band[1]?.map((e) => e.title)).toEqual(["Trip"]); // Mon
    expect(band[2]?.map((e) => e.title)).toEqual(["Trip"]); // Tue
    expect(band[3]).toBeUndefined(); // Wed — end is exclusive
    expect(band[0]).toBeUndefined(); // Sun — before it starts
  });

  it("respects hidden calendars", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      externalEvents: [
        { startIso: "2026-08-17T00:00:00.000Z", endIso: "2026-08-18T00:00:00.000Z", title: "Hidden", color: null, allDay: true, calendarId: "c1" },
      ] as LoaderData["externalEvents"],
    });
    expect(Object.keys(buildAllDayItems(data, days, new Set(["c1"])))).toHaveLength(0);
  });
});

describe("buildClassesLayer", () => {
  it("places Local class occurrences and marks the x-hour in the label", () => {
    const days = buildGridDays(WEEK, 7);
    const data = fixture({
      classOccurrences: [
        { classId: "c1", title: "CS 52", startIso: "2026-08-17T14:00:00.000Z", endIso: "2026-08-17T15:05:00.000Z", kind: "main" },
        { classId: "c1", title: "CS 52", startIso: "2026-08-20T16:00:00.000Z", endIso: "2026-08-20T16:50:00.000Z", kind: "xhour" },
      ],
    } as unknown as Partial<LoaderData>);
    const layer = buildClassesLayer(data, days);
    expect(layer[1][0]).toMatchObject({ label: "CS 52", startHour: 14 }); // Mon
    expect(layer[4][0].label).toBe("CS 52 · x-hour"); // Thu x-hour
  });
});

describe("mergeLayers", () => {
  it("concatenates blocks per day across layers", () => {
    const a = { 0: [{ startHour: 9 }], 1: [{ startHour: 10 }] } as unknown as Record<number, never>;
    const b = { 0: [{ startHour: 12 }] } as unknown as Record<number, never>;
    const merged = mergeLayers(a, b);
    expect(merged[0]).toHaveLength(2);
    expect(merged[1]).toHaveLength(1);
  });
});

describe("externalCalendarLegend", () => {
  it("dedupes enabled coloured sub-calendars by colour", () => {
    const data = fixture({
      calendarLinks: [
        {
          id: "l1",
          subCalendars: [
            { id: "c1", summary: "Personal", color: "#aaa", enabled: true, primary: true },
            { id: "c2", summary: "Dupe", color: "#aaa", enabled: true, primary: false },
            { id: "c3", summary: "Off", color: "#bbb", enabled: false, primary: false },
          ],
        },
      ] as unknown as LoaderData["calendarLinks"],
    });
    const legend = externalCalendarLegend(data);
    expect(legend).toEqual([{ swatch: "#aaa", label: "Personal" }]);
  });
});
