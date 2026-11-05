import { describe, expect, it } from "vitest";
import { DONE_PREVIEW, doneToggleLabel, doneView, railCount } from "../done-list";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, completedAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString() }));

describe("doneView", () => {
  it("shows the latest 5, newest first", () => {
    const v = doneView(items(8), false);
    expect(v.rows.map((r) => r.id)).toEqual(["t7", "t6", "t5", "t4", "t3"]);
    expect([v.total, v.hidden, v.canToggle]).toEqual([8, 3, true]);
  });

  it("shows everything, still newest first, when expanded", () => {
    const v = doneView(items(8), true);
    expect(v.rows).toHaveLength(8);
    expect(v.rows[0].id).toBe("t7");
    expect(v.hidden).toBe(0);
  });

  it("has no toggle at or under the preview size", () => {
    expect(doneView(items(DONE_PREVIEW), false).canToggle).toBe(false);
    expect(doneView(items(DONE_PREVIEW + 1), false).canToggle).toBe(true);
  });

  it("sorts tasks without a completion time last", () => {
    const v = doneView([{ id: "none", completedAt: null }, ...items(2)], true);
    expect(v.rows.map((r) => r.id)).toEqual(["t1", "t0", "none"]);
  });

  it("handles an empty list", () => {
    expect(doneView([], false)).toEqual({ rows: [], total: 0, hidden: 0, canToggle: false });
  });
});

describe("labels", () => {
  it("words the toggle for both states", () => {
    const v = doneView(items(8), false);
    expect(doneToggleLabel(v, false)).toBe("Show all 8 (3 more)");
    expect(doneToggleLabel(v, true)).toBe("Show only the latest 5");
  });

  it("caps the rail count at 99+ in the smaller size", () => {
    expect(railCount(0)).toEqual({ label: "0", small: false });
    expect(railCount(99)).toEqual({ label: "99", small: false });
    expect(railCount(100)).toEqual({ label: "99+", small: true });
  });
});
