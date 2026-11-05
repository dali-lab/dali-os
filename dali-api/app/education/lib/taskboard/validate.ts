import { clampPeriodWeeks, clampWeekCount, type PeriodKind } from "./weeks";
import type { TaskStatus } from "./rollover";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const STATUSES: TaskStatus[] = ["Backlog", "Todo", "Doing", "Done"];
const KINDS: PeriodKind[] = ["Term", "Interim", "Custom"];

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function optional(form: FormData, key: string): string | null {
  const v = text(form, key);
  return v === "" ? null : v;
}

function ids(form: FormData, key: string): string[] {
  return [...new Set(text(form, key).split(",").map((v) => v.trim()).filter(Boolean))];
}

function int(form: FormData, key: string): number {
  const v = text(form, key);
  return /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
}

export function isStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}

export type TaskInput = {
  title: string;
  description: string | null;
  periodId: string;
  week: number;
  weekday: number;
  milestoneId: string | null;
  assigneeIds: string[];
  status: TaskStatus;
};

export function parseTaskInput(form: FormData, weekCount: (periodId: string) => number | null): Parsed<TaskInput> {
  const title = text(form, "title");
  if (title === "") return { ok: false, error: "Add a title." };
  if (title.length > 200) return { ok: false, error: "Keep the title under 200 characters." };
  const description = optional(form, "description");
  if (description && description.length > 4000) {
    return { ok: false, error: "Keep the description under 4000 characters." };
  }
  const periodId = text(form, "periodId");
  const weeks = weekCount(periodId);
  if (weeks === null) return { ok: false, error: "Pick a term or period." };
  const week = int(form, "week");
  if (!Number.isInteger(week) || week < 1 || week > weeks) {
    return { ok: false, error: `Pick a week from 1 to ${weeks}.` };
  }
  const weekday = int(form, "weekday");
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: "Pick a day of the week." };
  }
  const statusRaw = text(form, "status") || "Backlog";
  if (!isStatus(statusRaw)) return { ok: false, error: "Pick a valid status." };
  return {
    ok: true,
    value: {
      title,
      description,
      periodId,
      week,
      weekday,
      milestoneId: optional(form, "milestoneId"),
      assigneeIds: ids(form, "assigneeIds"),
      status: statusRaw,
    },
  };
}

export type MilestoneInput = {
  name: string;
  description: string | null;
  periodId: string;
  startWeek: number;
  endWeek: number;
};

export function parseMilestoneInput(form: FormData, weekCount: (periodId: string) => number | null): Parsed<MilestoneInput> {
  const name = text(form, "name");
  if (name === "") return { ok: false, error: "Add a name." };
  if (name.length > 120) return { ok: false, error: "Keep the name under 120 characters." };
  const periodId = text(form, "periodId");
  const weeks = weekCount(periodId);
  if (weeks === null) return { ok: false, error: "Pick a term or period." };
  const startWeek = int(form, "startWeek");
  const endWeek = int(form, "endWeek");
  if (!Number.isInteger(startWeek) || !Number.isInteger(endWeek) || startWeek < 1 || endWeek > weeks || startWeek > endWeek) {
    return { ok: false, error: `Pick a span within weeks 1 to ${weeks}.` };
  }
  return {
    ok: true,
    value: { name, description: optional(form, "description"), periodId, startWeek, endWeek },
  };
}

export type PeriodInput = {
  name: string;
  shortName: string;
  kind: PeriodKind;
  startDate: string;
  weekCount: number;
};

export function isValidYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function parsePeriodInput(form: FormData): Parsed<PeriodInput> {
  const name = text(form, "name");
  if (name === "") return { ok: false, error: "Add a name." };
  if (name.length > 60) return { ok: false, error: "Keep the name under 60 characters." };
  const kind = text(form, "kind");
  if (!(KINDS as string[]).includes(kind)) return { ok: false, error: "Pick a type." };
  const startDate = text(form, "startDate");
  if (!isValidYmd(startDate)) return { ok: false, error: "Pick a start date." };
  if (new Date(`${startDate}T00:00:00Z`).getUTCDay() !== 0) {
    return { ok: false, error: "Periods start on a Sunday." };
  }
  const weeks = int(form, "weekCount");
  if (!Number.isInteger(weeks)) return { ok: false, error: "Enter the number of weeks." };
  return {
    ok: true,
    value: {
      name,
      shortName: text(form, "shortName") || name.slice(0, 8),
      kind: kind as PeriodKind,
      startDate,
      weekCount: clampPeriodWeeks(kind as PeriodKind, weeks),
    },
  };
}

export function parseSettingsInput(form: FormData): Parsed<{ termWeeks: number }> {
  const weeks = int(form, "termWeeks");
  if (!Number.isInteger(weeks)) return { ok: false, error: "Enter the number of weeks." };
  return { ok: true, value: { termWeeks: clampWeekCount(weeks) } };
}
