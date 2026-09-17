import { describe, it, expect, afterEach } from "vitest";
import { todayInputValue } from "../TaskModal";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// The seed a new task's start date opens with. Task dates are date-only values
// stored as UTC midnight, so the only thing that can go wrong here is picking
// the wrong *calendar day* — which is exactly what a naive toISOString() does
// for anyone west of UTC in the evening.
describe("todayInputValue", () => {
  it("is the viewer's own calendar date, not the UTC one", () => {
    // 21:30 on the 17th in New York is already the 18th in UTC. The task
    // belongs on the 17th — the day the person creating it is living in, and
    // the day the timeline's today marker sits on. Reading the UTC date here
    // would date every evening task in the Americas a day ahead.
    process.env.TZ = "America/New_York";
    expect(todayInputValue(new Date("2026-09-18T01:30:00.000Z"))).toBe("2026-09-17");
  });

  it("is still the local date east of UTC, where it runs the other way", () => {
    // 09:30 on the 18th in Auckland is still the 17th in UTC.
    process.env.TZ = "Pacific/Auckland";
    expect(todayInputValue(new Date("2026-09-17T21:30:00.000Z"))).toBe("2026-09-18");
  });

  it("formats as the YYYY-MM-DD a date input expects", () => {
    expect(todayInputValue(new Date(2026, 8, 17, 12))).toBe("2026-09-17");
  });

  it("pads single-digit months and days", () => {
    expect(todayInputValue(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });

  it("round-trips through the modal's own UTC-midnight write format", () => {
    // What the modal submits for this value, read back the way the picker
    // reads a stored date, has to be the same day.
    const value = todayInputValue(new Date(2026, 8, 17, 23, 59));
    const stored = `${value}T00:00:00.000Z`;
    expect(new Date(stored).toISOString().slice(0, 10)).toBe(value);
  });
});
