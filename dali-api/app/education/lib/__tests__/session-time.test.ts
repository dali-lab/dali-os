import { describe, it, expect } from "vitest";
import {
  sessionEnd,
  isSessionPast,
  isSessionUpcoming,
  summarizeAttendance,
  attendanceCopy,
} from "../session-time";

describe("sessionEnd", () => {
  it("falls back to datetime when endsAt is missing", () => {
    expect(sessionEnd({ datetime: "2026-01-01T10:00:00Z" })).toEqual(
      new Date("2026-01-01T10:00:00Z"),
    );
    expect(sessionEnd({ datetime: "2026-01-01T10:00:00Z", endsAt: null })).toEqual(
      new Date("2026-01-01T10:00:00Z"),
    );
  });

  it("uses endsAt when present", () => {
    expect(
      sessionEnd({ datetime: "2026-01-01T10:00:00Z", endsAt: "2026-01-01T11:00:00Z" }),
    ).toEqual(new Date("2026-01-01T11:00:00Z"));
  });
});

describe("isSessionPast / isSessionUpcoming", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("is not past when the end equals now (boundary)", () => {
    expect(isSessionPast({ datetime: now }, now)).toBe(false);
    expect(isSessionUpcoming({ datetime: now }, now)).toBe(true);
  });

  it("is past when the end is before now", () => {
    const s = { datetime: "2026-01-01T11:00:00Z" };
    expect(isSessionPast(s, now)).toBe(true);
    expect(isSessionUpcoming(s, now)).toBe(false);
  });

  it("is upcoming when the end is after now", () => {
    const s = { datetime: "2026-01-01T13:00:00Z" };
    expect(isSessionPast(s, now)).toBe(false);
    expect(isSessionUpcoming(s, now)).toBe(true);
  });
});

describe("summarizeAttendance", () => {
  const now = new Date("2026-01-15T00:00:00Z");
  const sessions = [
    { id: "s1", datetime: "2026-01-01T00:00:00Z" }, // past
    { id: "s2", datetime: "2026-01-02T00:00:00Z" }, // past
    { id: "s3", datetime: "2026-02-01T00:00:00Z" }, // future
  ];

  it("ignores Present marks on future sessions", () => {
    const marks = [
      { sessionId: "s1", status: "Present" },
      { sessionId: "s3", status: "Present" },
    ];
    expect(summarizeAttendance(sessions, marks, now)).toEqual({
      present: 1,
      excused: 0,
      held: 2,
      total: 3,
    });
  });

  it("counts excused marks on held sessions only", () => {
    const marks = [
      { sessionId: "s1", status: "Present" },
      { sessionId: "s2", status: "Excused" },
      { sessionId: "s3", status: "Excused" },
    ];
    expect(summarizeAttendance(sessions, marks, now)).toEqual({
      present: 1,
      excused: 1,
      held: 2,
      total: 3,
    });
  });
});

describe("attendanceCopy", () => {
  it("sentence style: in-progress course reads 'so far'", () => {
    expect(
      attendanceCopy({ present: 2, excused: 0, held: 3, total: 10 }, "sentence"),
    ).toBe("Attended 2 of 3 sessions so far");
  });

  it("sentence style: finished course omits 'so far'", () => {
    expect(
      attendanceCopy({ present: 2, excused: 0, held: 10, total: 10 }, "sentence"),
    ).toBe("Attended 2 of 10 sessions");
  });

  it("sentence style: no sessions held yet", () => {
    expect(
      attendanceCopy({ present: 0, excused: 0, held: 0, total: 5 }, "sentence"),
    ).toBe("No sessions held yet");
  });

  it("sentence style: excused suffix", () => {
    expect(
      attendanceCopy({ present: 2, excused: 1, held: 3, total: 10 }, "sentence"),
    ).toBe("Attended 2 (+1 excused) of 3 sessions so far");
  });

  it("ratio style: in-progress course reads 'so far'", () => {
    expect(attendanceCopy({ present: 2, excused: 0, held: 3, total: 10 }, "ratio")).toBe(
      "2/3 sessions so far",
    );
  });

  it("ratio style: finished course omits 'so far'", () => {
    expect(attendanceCopy({ present: 2, excused: 0, held: 10, total: 10 }, "ratio")).toBe(
      "2/10 sessions",
    );
  });

  it("ratio style: no sessions held yet", () => {
    expect(attendanceCopy({ present: 0, excused: 0, held: 0, total: 5 }, "ratio")).toBe(
      "No sessions held yet",
    );
  });

  it("ratio style: singular session when the denominator is 1", () => {
    expect(attendanceCopy({ present: 1, excused: 0, held: 1, total: 1 }, "ratio")).toBe(
      "1/1 session",
    );
  });
});
