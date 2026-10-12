import { describe, expect, it } from "vitest";
import {
  assembleWorkingHours,
  DEFAULT_WORK_END_MIN,
  DEFAULT_WORK_START_MIN,
  type WorkingHoursRow,
} from "~/calendar/lib/calendar-defaults";

function row(partial: Partial<WorkingHoursRow> & { dayOfWeek: number }): WorkingHoursRow {
  return {
    id: `r-${partial.dayOfWeek}-${partial.startMinute ?? 0}`,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    location: "InPerson",
    enabled: true,
    ...partial,
  };
}

describe("assembleWorkingHours", () => {
  it("falls back to Mon–Fri 9–5 when the user has never persisted hours", () => {
    const { workingHours, hasPersisted } = assembleWorkingHours([]);
    expect(hasPersisted).toBe(false);
    expect(workingHours).toHaveLength(7);
    expect(workingHours[0]!.segments).toEqual([]);
    expect(workingHours[1]!.segments).toMatchObject([
      { startMinute: DEFAULT_WORK_START_MIN, endMinute: DEFAULT_WORK_END_MIN },
    ]);
    expect(workingHours[6]!.segments).toEqual([]);
  });

  it("trusts persisted state over the default once any row exists", () => {
    // Only Tuesday persisted: Monday must come back empty, not defaulted.
    const { workingHours, hasPersisted } = assembleWorkingHours([
      row({ dayOfWeek: 2, startMinute: 600, endMinute: 720 }),
    ]);
    expect(hasPersisted).toBe(true);
    expect(workingHours[1]!.segments).toEqual([]);
    expect(workingHours[2]!.segments).toMatchObject([{ startMinute: 600, endMinute: 720 }]);
  });

  it("drops disabled and inverted rows and sorts a day's segments", () => {
    const { workingHours } = assembleWorkingHours([
      row({ dayOfWeek: 3, startMinute: 780, endMinute: 900 }),
      row({ dayOfWeek: 3, startMinute: 540, endMinute: 660 }),
      row({ dayOfWeek: 3, startMinute: 1000, endMinute: 1100, enabled: false }),
      row({ dayOfWeek: 4, startMinute: 700, endMinute: 600 }),
    ]);
    expect(workingHours[3]!.segments.map((s) => s.startMinute)).toEqual([540, 780]);
    expect(workingHours[4]!.segments).toEqual([]);
  });
});
