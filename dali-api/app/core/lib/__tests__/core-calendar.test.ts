import { describe, it, expect } from "vitest";
import { coreCalendarMeetingWhere } from "../core-calendar";

describe("coreCalendarMeetingWhere", () => {
  it("takes Core-group-scoped meetings and Core-marked ones", () => {
    expect(coreCalendarMeetingWhere("grp-core")).toEqual({
      status: { not: "Cancelled" },
      OR: [
        { scopeType: "Group", scopeId: "grp-core" },
        { isCoreMeeting: true },
      ],
    });
  });

  it("still matches Core-marked meetings before the Core group is seeded", () => {
    const where = coreCalendarMeetingWhere(null);
    // Never an empty OR — that would match nothing and blank the calendar.
    expect(where.OR).toEqual([{ isCoreMeeting: true }]);
  });

  it("excludes cancelled meetings either way", () => {
    expect(coreCalendarMeetingWhere("grp-core").status).toEqual({ not: "Cancelled" });
    expect(coreCalendarMeetingWhere(null).status).toEqual({ not: "Cancelled" });
  });
});
