import { describe, it, expect } from "vitest";
import { DEFAULT_RANGE, resolveRange, resolveWindow } from "~/admin/lib/insights-range";

describe("resolveRange", () => {
  it("accepts 7d, 30d and 90d", () => {
    expect(resolveRange("7d").days).toBe(7);
    expect(resolveRange("30d").days).toBe(30);
    expect(resolveRange("90d").days).toBe(90);
  });

  it("falls back to 30 days for a missing or unknown value", () => {
    expect(DEFAULT_RANGE).toBe("30d");
    expect(resolveRange(null).key).toBe("30d");
    expect(resolveRange("14d").key).toBe("30d");
  });
});

describe("resolveWindow", () => {
  const now = new Date("2026-10-27T15:00:00Z");
  const win = (search: string) => resolveWindow(new URLSearchParams(search), now);

  it("covers a preset's days ending today", () => {
    const w = win("range=7d");
    expect(w).toMatchObject({ key: "7d", firstDay: "2026-10-21", lastDay: "2026-10-27", days: 7 });
    expect(w.label).toBe("Last 7 days");
    expect(w.phrase).toBe("the last 7 days");
    expect(w.since).toEqual(new Date("2026-10-20T15:00:00Z"));
    expect(w.until).toEqual(new Date("2026-10-28T00:00:00Z"));
  });

  it("uses a dragged range with both days included", () => {
    const w = win("from=2026-10-03&to=2026-10-10");
    expect(w).toMatchObject({ key: null, firstDay: "2026-10-03", lastDay: "2026-10-10", days: 8 });
    expect(w.since).toEqual(new Date("2026-10-03T00:00:00Z"));
    expect(w.until).toEqual(new Date("2026-10-11T00:00:00Z"));
    expect(w.label).toBe("Oct 3 to Oct 10");
    expect(w.phrase).toBe("Oct 3 to Oct 10");
  });

  it("prefers the dragged range over a preset", () => {
    expect(win("range=7d&from=2026-10-03&to=2026-10-10").key).toBeNull();
  });

  it("allows a single day", () => {
    expect(win("from=2026-10-27&to=2026-10-27").days).toBe(1);
  });

  it.each([
    ["reversed", "from=2026-10-10&to=2026-10-03"],
    ["in the future", "from=2026-10-20&to=2026-10-28"],
    ["malformed", "from=2026-10-3&to=2026-10-10"],
    ["not a date", "from=2026-13-40&to=2026-10-10"],
    ["missing an end", "from=2026-10-03"],
  ])("falls back to the preset when the range is %s", (_, search) => {
    expect(win(`range=90d&${search}`)).toMatchObject({ key: "90d", days: 90 });
  });
});
