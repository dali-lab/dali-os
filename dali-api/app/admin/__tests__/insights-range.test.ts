import { describe, it, expect } from "vitest";
import { DEFAULT_RANGE, INSIGHTS_RANGE_OPTIONS, RANGE_OPTIONS, resolveRange, resolveWindow, wantsAllTime } from "~/admin/lib/insights-range";

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

  it("does not treat all time as a day preset", () => {
    expect(resolveRange("all").key).toBe("30d");
    expect(RANGE_OPTIONS.map((r) => r.key)).toEqual(["7d", "30d", "90d"]);
  });
});

describe("INSIGHTS_RANGE_OPTIONS", () => {
  it("adds All time after the day presets", () => {
    expect(INSIGHTS_RANGE_OPTIONS.map((r) => r.label)).toEqual(["7 days", "30 days", "90 days", "All time"]);
  });
});

describe("wantsAllTime", () => {
  it("is true only for range=all", () => {
    expect(wantsAllTime(new URLSearchParams("range=all"))).toBe(true);
    expect(wantsAllTime(new URLSearchParams("range=90d"))).toBe(false);
    expect(wantsAllTime(new URLSearchParams(""))).toBe(false);
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

  describe("all time", () => {
    it("counts from the epoch and charts from the first recorded day", () => {
      const w = resolveWindow(new URLSearchParams("range=all"), now, new Date("2026-04-27T09:30:00Z"));
      expect(w).toMatchObject({ key: "all", firstDay: "2026-04-27", lastDay: "2026-10-27", days: 184 });
      expect(w.since).toEqual(new Date(0));
      expect(w.until).toEqual(new Date("2026-10-28T00:00:00Z"));
      expect(w.label).toBe("All time");
      expect(w.phrase).toBe("the full history");
    });

    it("covers just today when nothing is recorded yet", () => {
      expect(win("range=all")).toMatchObject({ key: "all", firstDay: "2026-10-27", lastDay: "2026-10-27", days: 1 });
    });

    it("clamps an earliest row dated after today to today", () => {
      const w = resolveWindow(new URLSearchParams("range=all"), now, new Date("2026-11-02T00:00:00Z"));
      expect(w).toMatchObject({ firstDay: "2026-10-27", days: 1 });
    });

    it("yields to a dragged range", () => {
      expect(win("range=all&from=2026-10-03&to=2026-10-10")).toMatchObject({ key: null, days: 8 });
    });
  });
});
