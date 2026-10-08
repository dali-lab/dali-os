// Work experience on a profile. Client-safe: the card and the action share the
// labels, the month format and the form parsing.

export const WORK_MODES = [
  { value: "OnSite", label: "On-site" },
  { value: "Hybrid", label: "Hybrid" },
  { value: "Remote", label: "Remote" },
] as const;

export type WorkMode = (typeof WORK_MODES)[number]["value"];

export type WorkExperienceItem = {
  id: string;
  company: string;
  position: string;
  description: string | null;
  location: string | null;
  workMode: WorkMode | null;
  /** "YYYY-MM". A null endMonth is a current job. */
  startMonth: string;
  endMonth: string | null;
};

export function workModeLabel(mode: WorkMode | null): string | null {
  return WORK_MODES.find((m) => m.value === mode)?.label ?? null;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" → the first of that month, UTC. */
export function monthToDate(month: string): Date | null {
  const m = MONTH_RE.exec(month);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
}

export function dateToMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-06" → "Jun 2024". */
export function formatMonth(month: string): string {
  const m = MONTH_RE.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}

export function formatMonthRange(startMonth: string, endMonth: string | null): string {
  return `${formatMonth(startMonth)} to ${endMonth ? formatMonth(endMonth) : "present"}`;
}

export type WorkExperienceInput = {
  company: string;
  position: string;
  description: string | null;
  location: string | null;
  workMode: WorkMode | null;
  startDate: Date;
  endDate: Date | null;
};

/** Validate the card's form. An empty endMonth means a current job. */
export function parseWorkExperience(
  get: (field: string) => string,
): { ok: true; value: WorkExperienceInput } | { ok: false; error: string } {
  const text = (field: string) => get(field).trim();
  const company = text("company");
  const position = text("position");
  if (!company || !position) return { ok: false, error: "Company and position are required." };

  const startDate = monthToDate(text("startMonth"));
  if (!startDate) return { ok: false, error: "Pick a start month." };
  const endRaw = text("endMonth");
  const endDate = endRaw ? monthToDate(endRaw) : null;
  if (endRaw && !endDate) return { ok: false, error: "Pick an end month, or mark the job as current." };
  if (endDate && endDate < startDate) return { ok: false, error: "The end can't be before the start." };

  const modeRaw = text("workMode");
  const workMode = WORK_MODES.find((m) => m.value === modeRaw)?.value ?? null;
  if (modeRaw && !workMode) return { ok: false, error: "Pick a work mode." };

  return {
    ok: true,
    value: {
      company,
      position,
      description: text("description") || null,
      location: text("location") || null,
      workMode,
      startDate,
      endDate,
    },
  };
}
