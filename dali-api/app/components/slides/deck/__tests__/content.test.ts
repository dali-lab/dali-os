import { describe, expect, it } from "vitest";
import { niceTicks, pieSlices, formatTick } from "../chart-math";
import { ICON_NAMES, ICONS } from "../icon-set";
import {
  chartColors,
  chartDataFromTsv,
  chartDataToTsv,
  cleanChart,
  cleanIcon,
  cleanVideoUrl,
  contentFields,
  MAX_CHART_CATEGORIES,
  MAX_CHART_SERIES,
} from "../content";
import { THEMES } from "../themes";
import { resolveThemeColor } from "../../pptx/theme-colors";

const good = { type: "bar", data: { labels: ["A", "B"], series: [{ name: "S", values: [1, 2] }] } };

describe("cleanChart", () => {
  it("keeps a valid chart", () => {
    expect(cleanChart(good)).toEqual(good);
  });

  it("rejects unknown types, missing data and non-finite numbers", () => {
    expect(cleanChart({ ...good, type: "radar" })).toBeNull();
    expect(cleanChart({ type: "bar" })).toBeNull();
    expect(cleanChart(null)).toBeNull();
    expect(cleanChart({ ...good, data: { labels: ["A"], series: [{ name: "S", values: [Number.NaN] }] } })).toBeNull();
    expect(cleanChart({ ...good, data: { labels: ["A"], series: [{ name: "S", values: [Infinity] }] } })).toBeNull();
    expect(cleanChart({ ...good, data: { labels: ["A"], series: [{ name: "S", values: ["3"] }] } })).toBeNull();
  });

  it("caps categories and series and trims long labels", () => {
    const labels = Array.from({ length: MAX_CHART_CATEGORIES + 1 }, (_, i) => String(i));
    expect(cleanChart({ type: "line", data: { labels, series: [{ name: "S", values: [] }] } })).toBeNull();
    const series = Array.from({ length: MAX_CHART_SERIES + 1 }, () => ({ name: "S", values: [1] }));
    expect(cleanChart({ type: "line", data: { labels: ["A"], series } })).toBeNull();
    const long = cleanChart({ type: "pie", data: { labels: ["x".repeat(500)], series: [{ name: "n".repeat(500), values: [1] }] } })!;
    expect(long.data.labels[0]).toHaveLength(60);
    expect(long.data.series[0].name).toHaveLength(60);
  });

  it("pads short value lists and drops extra values so rows line up with labels", () => {
    const c = cleanChart({ type: "bar", data: { labels: ["A", "B", "C"], series: [{ name: "S", values: [1] }, { name: "T", values: [1, 2, 3, 4] }] } })!;
    expect(c.data.series.map((s) => s.values)).toEqual([[1, 0, 0], [1, 2, 3]]);
  });
});

describe("chart data from a spreadsheet", () => {
  it("reads a tab separated block with a header row and a label column", () => {
    expect(chartDataFromTsv("\tSales\tCosts\nQ1\t10\t4\nQ2\t$1,200\t5.5\n")).toEqual({
      labels: ["Q1", "Q2"],
      series: [
        { name: "Sales", values: [10, 1200] },
        { name: "Costs", values: [4, 5.5] },
      ],
    });
  });

  it("falls back to commas and rejects text where numbers belong", () => {
    expect(chartDataFromTsv("x,a\nQ1,3")?.series[0].values).toEqual([3]);
    expect(chartDataFromTsv("\ta\nQ1\tbanana")).toBeNull();
    expect(chartDataFromTsv("just one line")).toBeNull();
  });

  it("round trips through text", () => {
    const data = good.data;
    expect(chartDataFromTsv(chartDataToTsv(data))).toEqual(data);
  });
});

describe("icons and video links", () => {
  it("accepts names from the icon set only", () => {
    expect(cleanIcon("rocket")).toBe("rocket");
    expect(cleanIcon("not-an-icon")).toBeNull();
    expect(cleanIcon("__proto__")).toBeNull();
    expect(cleanIcon(7)).toBeNull();
  });

  it("has a component for every listed icon", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(200);
    for (const name of ICON_NAMES) expect(ICONS[name], name).toBeTruthy();
  });

  it("accepts links the provider registry resolves and nothing else", () => {
    expect(cleanVideoUrl(" https://youtu.be/dQw4w9WgXcQ ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(cleanVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeTruthy();
    expect(cleanVideoUrl("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(cleanVideoUrl("javascript:alert(1)")).toBeNull();
    expect(cleanVideoUrl(`https://youtu.be/${"a".repeat(3000)}`)).toBeNull();
  });

  it("reads only valid content fields", () => {
    const read = (k: string) => ({ chart: good, icon: "nope", videoUrl: "https://example.com/v" })[k as "chart"];
    expect(contentFields(read)).toEqual({ chart: good });
  });
});

describe("chart math", () => {
  it("picks round ticks that include zero", () => {
    expect(niceTicks(0, 24)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(niceTicks(-3, 8)[0]).toBeLessThanOrEqual(-3);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });

  it("formats big values compactly", () => {
    expect(formatTick(12)).toBe("12");
    expect(formatTick(15000)).toBe("15k");
    expect(formatTick(2500000)).toBe("2.5M");
  });

  it("splits a pie by share and ignores negatives", () => {
    const slices = pieSlices([1, 1, -5, 2]);
    expect(slices.map((s) => Math.round(s.share * 100))).toEqual([25, 25, 0, 50]);
    expect(slices[3].end).toBeCloseTo(Math.PI * 2);
    expect(pieSlices([0, 0]).every((s) => s.share === 0)).toBe(true);
  });
});

describe("chart colors", () => {
  it("come from the theme and resolve to hex for PowerPoint", () => {
    for (const theme of THEMES) {
      const colors = chartColors(theme);
      expect(colors.length).toBeGreaterThanOrEqual(6);
      expect(colors[0]).toBe(theme.colors.accent);
      for (const c of colors) expect(resolveThemeColor(c), c).toMatch(/^[0-9A-F]{6}$/);
    }
  });
});
