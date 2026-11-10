import { describe, expect, it } from "vitest";
import { attendanceLabel, meetingPlaceLabel, meetingSubtitle } from "./meeting-strip-model";

describe("meeting strip model", () => {
  it("counts who came out of who was expected", () => {
    expect(attendanceLabel([{ present: true }, { present: false }, { present: true }])).toBe("2 of 3");
    expect(attendanceLabel([])).toBe("0 of 0");
  });

  it("prefers room names over free-text location", () => {
    expect(meetingPlaceLabel({ roomNames: ["Studio A", "Studio B"], location: "Hall" })).toBe("Studio A, Studio B");
    expect(meetingPlaceLabel({ roomNames: [], location: " Hall " })).toBe("Hall");
    expect(meetingPlaceLabel({ roomNames: [], location: null })).toBeNull();
  });

  it("reads time and room before, and time and recorded length after", () => {
    const startIso = "2026-11-05T15:00:00.000Z";
    expect(meetingSubtitle({ startIso, place: "Studio A", recordedMinutes: null })).toBe("Thu, Nov 5, 10:00 AM · Studio A");
    expect(meetingSubtitle({ startIso, place: "Studio A", recordedMinutes: 42 })).toBe("Thu, Nov 5, 10:00 AM · Recorded 42 min");
    expect(meetingSubtitle({ startIso, place: null, recordedMinutes: null })).toBe("Thu, Nov 5, 10:00 AM");
  });
});
