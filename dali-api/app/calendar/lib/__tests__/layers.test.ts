import { describe, it, expect } from "vitest";
import {
  buildGridDays,
  buildExternalLayer,
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
  it("groups enabled sub-calendars by account, labelling primaries", () => {
    const data = fixture({
      calendarLinks: [
        {
          id: "l1",
          displayName: "Work",
          externalEmail: "me@work.com",
          subCalendars: [
            { id: "c1", summary: "me@work.com", color: "#aaa", enabled: true, primary: true },
            { id: "c2", summary: "Classes", color: "#aaa", enabled: true, primary: false },
            { id: "c3", summary: "Off", color: "#bbb", enabled: false, primary: false },
          ],
        },
      ] as unknown as LoaderData["calendarLinks"],
    });
    expect(perCalendarLegend(data)).toEqual([
      {
        account: "Work",
        calendars: [
          { id: "c1", label: "Primary", color: "#aaa" }, // primary → "Primary", not the email
          { id: "c2", label: "Classes", color: "#aaa" },
        ],
      },
    ]);
  });

  it("keeps each account's calendars in their own group", () => {
    const data = fixture({
      calendarLinks: [
        {
          id: "l1",
          displayName: null,
          externalEmail: "a@x.com",
          subCalendars: [{ id: "c1", summary: "a@x.com", color: "#111", enabled: true, primary: true }],
        },
        {
          id: "l2",
          displayName: null,
          externalEmail: "b@y.com",
          subCalendars: [{ id: "c2", summary: "b@y.com", color: "#222", enabled: true, primary: true }],
        },
      ] as unknown as LoaderData["calendarLinks"],
    });
    const groups = perCalendarLegend(data);
    expect(groups.map((g) => g.account)).toEqual(["a@x.com", "b@y.com"]);
    expect(groups.every((g) => g.calendars.length === 1)).toBe(true);
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
      timeEntries: [
        {
          id: "t-m", source: "Meeting", scheduledMeetingId: "m1", manualBlockId: null, meetingNotePageId: null,
          assignmentType: null, roleRefId: null, projectId: null, date: "2026-08-18", hours: 0.5, note: null,
          startTime: "2026-08-18T10:00:00.000Z", endTime: "2026-08-18T10:30:00.000Z",
        },
        {
          id: "t-s", source: "Manual", scheduledMeetingId: null, manualBlockId: null, meetingNotePageId: null,
          assignmentType: null, roleRefId: null, projectId: null, date: "2026-08-18", hours: 1, note: "Email",
          startTime: "2026-08-18T16:00:00.000Z", endTime: "2026-08-18T17:00:00.000Z",
        },
        // The work half of a calendar event ("count this as work"): same shape
        // as a meeting-sourced row, keyed on the event instead.
        {
          id: "t-e", source: "Manual", scheduledMeetingId: null, sourceEventId: "e1", manualBlockId: null,
          meetingNotePageId: null, assignmentType: null, roleRefId: null, projectId: null,
          date: "2026-08-18", hours: 2, note: "Studio",
          startTime: "2026-08-18T13:00:00.000Z", endTime: "2026-08-18T15:00:00.000Z",
        },
      ] as LoaderData["timeEntries"],
    });
  }

  it("indexes sourced logged hours by meeting and by event", () => {
    const idx = buildLoggedSourceIndex(loggedFixture());
    expect(idx.byMeeting.get("m1")?.hours).toBe(0.5);
    expect(idx.byEvent.get("e1")?.hours).toBe(2);
    // A standalone entry belongs to neither index — it draws its own block.
    expect(idx.byMeeting.size).toBe(1);
    expect(idx.byEvent.size).toBe(1);
  });

  it("sums repeat logs against one event and takes the role's colour override", () => {
    const data = loggedFixture();
    data.timeEntries = [
      ...data.timeEntries,
      {
        ...data.timeEntries[2]!, id: "t-e2", hours: 1.5,
        startTime: "2026-08-18T18:00:00.000Z", endTime: "2026-08-18T19:30:00.000Z",
      },
    ];
    const idx = buildLoggedSourceIndex(data, undefined, { unassigned: "#abcdef" });
    expect(idx.byEvent.get("e1")?.hours).toBe(3.5);
    expect(idx.byEvent.get("e1")?.color).toBe("#abcdef");
  });

  it("indexes nothing for a role that's filtered out", () => {
    const idx = buildLoggedSourceIndex(loggedFixture(), new Set(["unassigned"]));
    expect(idx.byMeeting.size).toBe(0);
    expect(idx.byEvent.size).toBe(0);
  });

  it("suppresses sourced entries whose source layer is visible, keeps standalone", () => {
    const logged = buildLoggedTimeLayer(loggedFixture(), days, {
      suppressSourced: { meetings: true, events: true },
    });
    expect((logged[2] ?? []).map((b) => b.label)).toEqual(["Email"]);
  });

  it("keeps a sourced entry when its source layer is hidden", () => {
    const logged = buildLoggedTimeLayer(loggedFixture(), days, {
      suppressSourced: { meetings: false, events: false },
    });
    const labels = (logged[2] ?? []).map((b) => b.label);
    expect(labels).toContain("Meeting"); // meeting hidden → its logged block still draws
    expect(labels).toContain("Studio"); // ditto the work-marked event's entry
    expect(labels).toContain("Email");
  });

  it("accents a work-marked event's own block instead of drawing a second one", () => {
    const data = loggedFixture();
    data.externalEvents = [
      { startIso: "2026-08-18T13:00:00.000Z", endIso: "2026-08-18T15:00:00.000Z", title: "Studio", color: null, calendarId: "c1", eventId: "e1", writable: true },
      { startIso: "2026-08-18T20:00:00.000Z", endIso: "2026-08-18T21:00:00.000Z", title: "Plain", color: null, calendarId: "c1", eventId: "e2", writable: true },
    ] as LoaderData["externalEvents"];
    const idx = buildLoggedSourceIndex(data);
    const external = buildExternalLayer(data, days, undefined, undefined, undefined, undefined, undefined, idx.byEvent);
    const blocks = external[2] ?? [];
    expect(blocks.find((b) => b.label === "Studio")?.loggedAccent?.hours).toBe(2);
    expect(blocks.find((b) => b.label === "Plain")?.loggedAccent).toBeUndefined();
  });

  it("draws events plain when the logged layer is off (no accents passed)", () => {
    const data = loggedFixture();
    data.externalEvents = [
      { startIso: "2026-08-18T13:00:00.000Z", endIso: "2026-08-18T15:00:00.000Z", title: "Studio", color: null, calendarId: "c1", eventId: "e1", writable: true },
    ] as LoaderData["externalEvents"];
    const external = buildExternalLayer(data, days);
    expect((external[2] ?? [])[0]?.loggedAccent).toBeUndefined();
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
