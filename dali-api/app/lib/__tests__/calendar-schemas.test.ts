import { describe, it, expect } from "vitest";
import {
  AddTimeEntrySchema,
  UpdateTimeEntrySchema,
  validateTimeEntryRange,
} from "~/lib/calendar-schemas";

const START = "2026-05-12T13:00:00.000Z";
const END = "2026-05-12T14:30:00.000Z"; // 1.5h after START

describe("validateTimeEntryRange", () => {
  it("accepts a range whose hours match the start/end span", () => {
    expect(validateTimeEntryRange({ startTime: START, endTime: END, hours: 1.5 })).toBeNull();
  });

  it("rejects an end at or before the start", () => {
    expect(validateTimeEntryRange({ startTime: END, endTime: START, hours: 1.5 })).toBe(
      "End time must be after start time",
    );
    expect(validateTimeEntryRange({ startTime: START, endTime: START, hours: 0.5 })).toBe(
      "End time must be after start time",
    );
  });

  it("rejects hours that disagree with the range — a hand-rolled POST can't inflate time", () => {
    expect(validateTimeEntryRange({ startTime: START, endTime: END, hours: 8 })).toBe(
      "Hours must match the start/end range",
    );
  });

  it("tolerates sub-minute rounding drift between derived and submitted hours", () => {
    // 1.5h span submitted as 1.51 — within HOURS_TOLERANCE.
    expect(validateTimeEntryRange({ startTime: START, endTime: END, hours: 1.51 })).toBeNull();
  });

  it("rejects a span longer than 24 hours", () => {
    expect(
      validateTimeEntryRange({
        startTime: START,
        endTime: "2026-05-14T13:00:00.000Z",
        hours: 48,
      }),
    ).toBe("An entry can't be longer than 24 hours");
  });

  it("rejects unparseable timestamps", () => {
    expect(validateTimeEntryRange({ startTime: "nonsense", endTime: END, hours: 1 })).toBe(
      "Invalid start or end time",
    );
  });

  it("skips the range checks when either side is absent (update patches)", () => {
    expect(validateTimeEntryRange({ startTime: START, endTime: null, hours: 1.5 })).toBeNull();
    expect(validateTimeEntryRange({ hours: 1.5 })).toBeNull();
  });

  it("validates the range even when hours aren't supplied", () => {
    expect(validateTimeEntryRange({ startTime: END, endTime: START })).toBe(
      "End time must be after start time",
    );
  });
});

describe("AddTimeEntrySchema", () => {
  const valid = {
    intent: "add-time-entry" as const,
    date: "2026-05-12T00:00:00.000Z",
    hours: 1.5,
    assignmentType: "Project" as const,
    roleRefId: "assignment-1",
    startTime: START,
    endTime: END,
  };

  it("accepts a fully attributed, time-ranged entry", () => {
    expect(AddTimeEntrySchema.safeParse(valid).success).toBe(true);
  });

  // The "unassigned" bucket is legacy-read-only: nothing may create one.
  it("rejects an entry with no role", () => {
    const { assignmentType: _a, roleRefId: _r, ...noRole } = valid;
    expect(AddTimeEntrySchema.safeParse(noRole).success).toBe(false);
    expect(AddTimeEntrySchema.safeParse({ ...valid, assignmentType: null }).success).toBe(false);
    expect(AddTimeEntrySchema.safeParse({ ...valid, roleRefId: null }).success).toBe(false);
    expect(AddTimeEntrySchema.safeParse({ ...valid, roleRefId: "" }).success).toBe(false);
  });

  it("rejects an entry with no start/end time", () => {
    const { startTime: _s, endTime: _e, ...noRange } = valid;
    expect(AddTimeEntrySchema.safeParse(noRange).success).toBe(false);
    expect(AddTimeEntrySchema.safeParse({ ...valid, startTime: null }).success).toBe(false);
  });
});

describe("UpdateTimeEntrySchema", () => {
  it("allows a partial patch that omits role and range", () => {
    const res = UpdateTimeEntrySchema.safeParse({
      intent: "update-time-entry",
      id: "te-1",
      note: "just a note change",
    });
    expect(res.success).toBe(true);
  });

  it("rejects clearing a role back to unassigned", () => {
    expect(
      UpdateTimeEntrySchema.safeParse({
        intent: "update-time-entry",
        id: "te-1",
        assignmentType: null,
        roleRefId: null,
      }).success,
    ).toBe(false);
  });
});
