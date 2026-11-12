import { describe, it, expect } from "vitest";
import {
  isWithinCheckInWindow,
  meetingIsUpcoming,
  ownsGoogleEvent,
  tracksAttendance,
} from "~/calendar/lib/meeting-occurrences";

describe("ownsGoogleEvent", () => {
  it.each([
    ["Created", "abc", true],
    [null, "abc", true],
    [undefined, "abc", true],
    [null, null, true],
    ["Tracked", "abc", false],
    ["Tracked", null, false],
    [null, "abc_R20260928T130000", false],
    ["Created", "abc_R20260928T130000Z", false],
    [null, "abc_20261019T130000Z", true],
  ] as const)("origin %s, id %s -> %s", (googleEventOrigin, externalEventId, expected) => {
    expect(ownsGoogleEvent({ googleEventOrigin, externalEventId })).toBe(expected);
  });
});

describe("tracksAttendance", () => {
  const base = { meetingType: null, notebookId: null, attendanceMode: "None", participantUserIds: [] as string[] };

  it("is false for a typeless meeting with nothing else", () => {
    expect(tracksAttendance(base)).toBe(false);
  });

  it("is true with a type", () => {
    expect(tracksAttendance({ ...base, meetingType: "Other" })).toBe(true);
  });

  it("is true with a notebook and no type", () => {
    expect(tracksAttendance({ ...base, notebookId: "nb-1" })).toBe(true);
  });

  it("is true for self check-in", () => {
    expect(tracksAttendance({ ...base, attendanceMode: "SelfCheckIn" })).toBe(true);
  });

  it("is true with invited people", () => {
    expect(tracksAttendance({ ...base, participantUserIds: ["u1"] })).toBe(true);
  });
});

describe("meetingIsUpcoming", () => {
  const now = new Date("2026-09-16T12:00:00Z");

  it("is over once a one-off meeting has ended", () => {
    const base = { durationMinutes: 60, recurrenceRule: null };
    expect(meetingIsUpcoming({ ...base, selectedAt: new Date("2026-09-16T10:30:00Z") }, now)).toBe(false);
    // Still in progress counts as upcoming — invitees can still make it.
    expect(meetingIsUpcoming({ ...base, selectedAt: new Date("2026-09-16T11:30:00Z") }, now)).toBe(true);
  });

  it("treats a series or an unscheduled meeting as upcoming", () => {
    const past = new Date("2026-01-01T10:00:00Z");
    expect(meetingIsUpcoming({ selectedAt: past, durationMinutes: 30, recurrenceRule: "FREQ=WEEKLY" }, now)).toBe(true);
    expect(meetingIsUpcoming({ selectedAt: null, durationMinutes: 30, recurrenceRule: null }, now)).toBe(true);
  });
});

describe("isWithinCheckInWindow", () => {
  const HOUR = 60 * 60_000;
  // A Tuesday 10:00 UTC meeting, one hour long, repeating weekly.
  const firstStart = new Date("2026-09-01T10:00:00.000Z");
  const weekly = {
    selectedAt: firstStart,
    durationMinutes: 60,
    recurrenceRule: "FREQ=WEEKLY;BYDAY=TU",
  };

  it("accepts a check-in during the first occurrence", () => {
    expect(isWithinCheckInWindow(weekly, [], firstStart.getTime() + 10 * 60_000)).toBe(true);
  });

  // The regression: selectedAt never advances, so testing it directly meant
  // every sitting after the first reported "window closed" mid-meeting.
  it("accepts a check-in during a later occurrence of a recurring meeting", () => {
    const fourWeeksLater = firstStart.getTime() + 28 * 24 * HOUR;
    expect(isWithinCheckInWindow(weekly, [], fourWeeksLater + 10 * 60_000)).toBe(true);
  });

  it("still rejects a time between occurrences", () => {
    // Wednesday, a day after an occurrence ended.
    const between = firstStart.getTime() + 25 * HOUR;
    expect(isWithinCheckInWindow(weekly, [], between)).toBe(false);
  });

  it("honours the ±15min grace on either side of an occurrence", () => {
    const third = firstStart.getTime() + 14 * 24 * HOUR;
    expect(isWithinCheckInWindow(weekly, [], third - 10 * 60_000)).toBe(true);
    expect(isWithinCheckInWindow(weekly, [], third - 20 * 60_000)).toBe(false);
    expect(isWithinCheckInWindow(weekly, [], third + HOUR + 10 * 60_000)).toBe(true);
    expect(isWithinCheckInWindow(weekly, [], third + HOUR + 20 * 60_000)).toBe(false);
  });

  it("judges a rescheduled occurrence at its override time, not its original slot", () => {
    const originalStart = new Date(firstStart.getTime() + 7 * 24 * HOUR);
    const overrideStart = new Date(originalStart.getTime() + 2 * 24 * HOUR);
    const exceptions = [
      { originalStart, overrideStart, overrideDurationMin: null, cancelled: false },
    ];
    expect(isWithinCheckInWindow(weekly, exceptions, overrideStart.getTime() + 5 * 60_000)).toBe(
      true,
    );
    expect(isWithinCheckInWindow(weekly, exceptions, originalStart.getTime() + 5 * 60_000)).toBe(
      false,
    );
  });

  it("rejects a cancelled occurrence", () => {
    const originalStart = new Date(firstStart.getTime() + 7 * 24 * HOUR);
    const exceptions = [
      { originalStart, overrideStart: null, overrideDurationMin: null, cancelled: true },
    ];
    expect(isWithinCheckInWindow(weekly, exceptions, originalStart.getTime() + 5 * 60_000)).toBe(
      false,
    );
  });

  it("handles a one-off meeting, and has no window without a scheduled time", () => {
    const oneOff = { selectedAt: firstStart, durationMinutes: 60, recurrenceRule: null };
    expect(isWithinCheckInWindow(oneOff, [], firstStart.getTime() + 5 * 60_000)).toBe(true);
    expect(isWithinCheckInWindow(oneOff, [], firstStart.getTime() + 3 * HOUR)).toBe(false);
    expect(
      isWithinCheckInWindow({ selectedAt: null, durationMinutes: 60, recurrenceRule: null }, []),
    ).toBe(false);
  });
});
