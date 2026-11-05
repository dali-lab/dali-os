import { MAX_WEEKS, MIN_FLEX_WEEKS, addDays, type PeriodKind } from "./weeks";

type Season = { name: string; letter: "W" | "S" | "X" | "F" };

const WINTER: Season = { name: "Winter", letter: "W" };
const SPRING: Season = { name: "Spring", letter: "S" };
const SUMMER: Season = { name: "Summer", letter: "X" };
const FALL: Season = { name: "Fall", letter: "F" };

const DAY_MS = 86_400_000;

function seasonOf(month: number): Season {
  if (month >= 9 && month <= 11) return FALL;
  if (month >= 6 && month <= 8) return SUMMER;
  if (month >= 3 && month <= 5) return SPRING;
  return WINTER;
}

function parts(ymd: string): { year: number; month: number } {
  const [year, month] = ymd.split("-").map(Number);
  return { year, month };
}

export function termShortName(startYmd: string): string {
  const { year, month } = parts(startYmd);
  const termYear = month === 12 ? year + 1 : year;
  return `${String(termYear).slice(-2)}${seasonOf(month).letter}`;
}

export function suggestPeriodName(kind: PeriodKind, startYmd: string): string {
  if (!startYmd) return kind === "Term" ? "New term" : kind === "Interim" ? "Interim" : "New period";
  const { month } = parts(startYmd);
  const season = seasonOf(month);
  if (kind === "Term") return `${season.name} ${termShortName(startYmd)}`;
  if (kind === "Interim") return `${season.name} interim`;
  return "New period";
}

export function suggestShortName(kind: PeriodKind, name: string, startYmd: string): string {
  if (kind === "Term" && startYmd) return termShortName(startYmd);
  if (kind === "Interim") return "Int";
  return name.trim().slice(0, 8);
}

export function lengthFromEnd(startYmd: string, endYmd: string): number {
  const days = (Date.parse(`${endYmd}T00:00:00Z`) - Date.parse(`${startYmd}T00:00:00Z`)) / DAY_MS + 1;
  if (!Number.isFinite(days) || days < 1) return MIN_FLEX_WEEKS;
  return Math.min(MAX_WEEKS, Math.max(MIN_FLEX_WEEKS, Math.ceil(days / 7)));
}

export function endFromLength(startYmd: string, weeks: number): string {
  return addDays(startYmd, weeks * 7 - 1);
}

export function periodSummary(kind: PeriodKind, weeks: number, usesDefault: boolean): string {
  if (kind === "Term") {
    const source = usesDefault ? "from your term setting, " : "";
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ${source}numbered Week 1 to ${weeks}.`;
  }
  return `${weeks} ${weeks === 1 ? "week" : "weeks"}. Pick any end date for interims and custom ranges.`;
}
