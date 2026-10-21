import { describe, it, expect } from "vitest";
import { slotStatus } from "~/calendar/lib/slot-availability";

const iv = (start: string, end: string) => ({
  startIso: `2026-10-26T${start}:00.000Z`,
  endIso: `2026-10-26T${end}:00.000Z`,
});
const ms = (t: string) => new Date(`2026-10-26T${t}:00.000Z`).getTime();

describe("slotStatus", () => {
  const working = [iv("13:00", "21:00")];

  it("is available when one free interval covers the slot", () => {
    expect(slotStatus({ free: [iv("14:00", "16:00")], working }, ms("14:00"), ms("15:00"))).toBe("available");
  });

  it("is available when adjacent free intervals together cover the slot", () => {
    const free = [iv("15:00", "16:00"), iv("14:00", "15:00")];
    expect(slotStatus({ free, working }, ms("14:00"), ms("16:00"))).toBe("available");
  });

  it("is busy when the slot is inside working hours but not free", () => {
    expect(slotStatus({ free: [iv("14:00", "14:30")], working }, ms("14:00"), ms("15:00"))).toBe("busy");
  });

  it("is outside hours when the day has no working hours", () => {
    expect(slotStatus({ free: [], working: [] }, ms("18:15"), ms("19:15"))).toBe("outsideHours");
  });

  it("is outside hours when the slot runs past the end of working hours", () => {
    expect(slotStatus({ free: [iv("20:00", "21:00")], working }, ms("20:30"), ms("21:30"))).toBe("outsideHours");
  });

  it("is outside hours rather than busy when both apply", () => {
    expect(slotStatus({ free: [], working }, ms("12:30"), ms("13:30"))).toBe("outsideHours");
  });

  it("treats a gap between two working segments as outside hours", () => {
    const split = [iv("13:00", "16:00"), iv("17:00", "21:00")];
    expect(slotStatus({ free: split, working: split }, ms("15:30"), ms("17:30"))).toBe("outsideHours");
  });
});

describe("slotStatus with Date intervals", () => {
  const d = (t: string) => new Date(`2026-10-26T${t}:00.000Z`);
  const working = [{ start: d("13:00"), end: d("21:00") }];

  it("classifies server-side intervals the same way", () => {
    expect(slotStatus({ free: [{ start: d("14:00"), end: d("16:00") }], working }, ms("14:00"), ms("15:00"))).toBe("available");
    expect(slotStatus({ free: [], working }, ms("14:00"), ms("15:00"))).toBe("busy");
    expect(slotStatus({ free: [], working }, ms("21:00"), ms("22:00"))).toBe("outsideHours");
  });
});
