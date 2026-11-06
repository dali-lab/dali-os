import * as Y from "yjs";
import { parseVideoEmbed } from "~/lib/video-embed";
import { isIconName } from "./icon-set";
import type { ThemeDef } from "./themes";

export const CHART_TYPES = ["bar", "line", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const CHART_LABELS: Record<ChartType, string> = { bar: "Bar chart", line: "Line chart", pie: "Pie chart" };

export const MAX_CHART_CATEGORIES = 24;
export const MAX_CHART_SERIES = 6;
const MAX_CHART_TEXT = 60;

export interface ChartData {
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
}

export interface ChartSpec {
  type: ChartType;
  data: ChartData;
}

export const DEFAULT_CHART_DATA: ChartData = {
  labels: ["Q1", "Q2", "Q3", "Q4"],
  series: [{ name: "Series 1", values: [12, 19, 8, 24] }],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "").slice(0, MAX_CHART_TEXT);

export function cleanChartData(raw: unknown): ChartData | null {
  if (!isObj(raw) || !Array.isArray(raw.labels) || !Array.isArray(raw.series)) return null;
  if (raw.labels.length === 0 || raw.labels.length > MAX_CHART_CATEGORIES || raw.series.length === 0 || raw.series.length > MAX_CHART_SERIES) return null;
  const labels = raw.labels.map(text);
  const series: ChartData["series"] = [];
  for (const s of raw.series) {
    if (!isObj(s) || !Array.isArray(s.values) || s.values.length > MAX_CHART_CATEGORIES) return null;
    if (!s.values.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const values = (s.values as number[]).slice(0, labels.length);
    while (values.length < labels.length) values.push(0);
    series.push({ name: text(s.name), values });
  }
  return { labels, series };
}

export function cleanChart(raw: unknown): ChartSpec | null {
  if (!isObj(raw) || !CHART_TYPES.includes(raw.type as ChartType)) return null;
  const data = cleanChartData(raw.data);
  return data ? { type: raw.type as ChartType, data } : null;
}

function parseNumber(cell: string): number | null {
  const cleaned = cell.trim().replace(/[$€£%\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A spreadsheet selection pasted as text: a header row of series names, then one row per category. */
export function chartDataFromTsv(input: string): ChartData | null {
  const rows = input
    .replace(/\r/g, "")
    .split("\n")
    .filter((r) => r.trim() !== "")
    .map((r) => r.split(r.includes("\t") ? "\t" : ","));
  if (rows.length < 2 || rows[0].length < 2) return null;
  const [header, ...body] = rows;
  const names = header.slice(1).map((n) => n.trim());
  const labels = body.map((r) => (r[0] ?? "").trim());
  const series = names.map((name, i) => ({ name, values: [] as number[] }));
  for (const row of body) {
    for (let i = 0; i < names.length; i++) {
      const n = parseNumber(row[i + 1] ?? "");
      if (n === null) return null;
      series[i].values.push(n);
    }
  }
  return cleanChartData({ labels, series });
}

export function chartDataToTsv(data: ChartData): string {
  const head = ["", ...data.series.map((s) => s.name)].join("\t");
  const rows = data.labels.map((label, i) => [label, ...data.series.map((s) => String(s.values[i] ?? 0))].join("\t"));
  return [head, ...rows].join("\n");
}

export function chartColors(theme: ThemeDef): string[] {
  const { accent, fg, muted, ground } = theme.colors;
  const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  return [accent, fg, muted, mix(accent, 55, fg), mix(accent, 55, ground), mix(muted, 55, accent)];
}

export const chartIsEmpty = (chart: ChartSpec) => chart.data.series.every((s) => s.values.every((v) => v === 0));

export function cleanIcon(raw: unknown): string | null {
  return isIconName(raw) ? raw : null;
}

export const MAX_VIDEO_URL = 2048;

export function cleanVideoUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_VIDEO_URL) return null;
  const url = raw.trim();
  return parseVideoEmbed(url) ? url : null;
}

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 6;
export const MAX_POLL_QUESTION = 200;
export const MAX_POLL_OPTION = 80;

export interface PollSpec {
  question: string;
  options: string[];
  multi?: boolean;
}

export const DEFAULT_POLL: PollSpec = { question: "What do you think?", options: ["Option 1", "Option 2"] };

export function cleanPoll(raw: unknown): PollSpec | null {
  if (!isObj(raw) || typeof raw.question !== "string" || !Array.isArray(raw.options)) return null;
  const options = raw.options.filter((o): o is string => typeof o === "string").map((o) => o.trim().slice(0, MAX_POLL_OPTION));
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS || options.some((o) => o === "")) return null;
  return { question: raw.question.trim().slice(0, MAX_POLL_QUESTION), options, ...(raw.multi === true ? { multi: true } : {}) };
}

export const MAX_HTML_CHARS = 200_000;

const NUL = /\u0000/g;

/** Source text for a custom HTML element, with NUL bytes removed. Null when it is not text or is over the cap. */
export function cleanHtmlSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(NUL, "");
  return text.length > MAX_HTML_CHARS ? null : text;
}

/** The same source read defensively from a doc: a Y.Text or a string, cut at the cap instead of refused. */
export function htmlSourceOf(raw: unknown): string | undefined {
  const text = raw instanceof Y.Text ? raw.toString() : typeof raw === "string" ? raw : null;
  return text === null ? undefined : text.replace(NUL, "").slice(0, MAX_HTML_CHARS);
}

export function contentFields(read: (key: string) => unknown) {
  const html = htmlSourceOf(read("html"));
  const poll = cleanPoll(read("poll"));
  const chart = cleanChart(read("chart"));
  const icon = cleanIcon(read("icon"));
  const videoUrl = cleanVideoUrl(read("videoUrl"));
  return {
    ...(chart ? { chart } : {}),
    ...(icon ? { icon } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    ...(poll ? { poll } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(read("htmlFill") === true ? { htmlFill: true as const } : {}),
  };
}
