import {
  WORK_MODES,
  monthToDate,
  type WorkExperienceItem,
  type WorkMode,
} from "./work-experience";

export type ImportedJob = {
  key: string;
  company: string;
  position: string;
  description: string | null;
  location: string | null;
  workMode: WorkMode | null;
  /** "YYYY-MM", or "" when unknown. */
  startMonth: string;
  /** Prefill for the month picker when only the year is known. */
  startYear: number | null;
  /** "" = none. */
  endMonth: string;
  endYear: number | null;
  current: boolean;
};

export const MAX_IMPORTED_JOBS = 40;
const MIN_YEAR = 1950;

export class NotPositionsFileError extends Error {
  constructor() {
    super("This doesn't look like LinkedIn's Positions.csv.");
    this.name = "NotPositionsFileError";
  }
}

export type RawJob = {
  company?: unknown;
  position?: unknown;
  description?: unknown;
  location?: unknown;
  workMode?: unknown;
  start?: { year?: unknown; month?: unknown } | null;
  end?: { year?: unknown; month?: unknown } | null;
  current?: unknown;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function clampYear(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  const max = new Date().getUTCFullYear() + 1;
  return value >= MIN_YEAR && value <= max ? value : null;
}

function validMonth(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
}

function toMonthString(year: number | null, month: number | null): string {
  if (year === null || month === null) return "";
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Normalizes one parsed job (from the model or a CSV row). Null when the job
 *  has no company or no position. */
export function toImportedJob(raw: RawJob, index = 0): ImportedJob | null {
  const company = clean(raw.company);
  const position = clean(raw.position);
  if (!company || !position) return null;

  const startYear = clampYear(raw.start?.year);
  const startMonth = toMonthString(startYear, validMonth(raw.start?.month));
  const current = raw.current === true;
  const endYear = current ? null : clampYear(raw.end?.year);
  const endMonth = current ? "" : toMonthString(endYear, validMonth(raw.end?.month));
  const workMode = WORK_MODES.find((m) => m.value === raw.workMode)?.value ?? null;

  return {
    key: `job-${index}`,
    company,
    position,
    description: clean(raw.description),
    location: clean(raw.location),
    workMode,
    startMonth,
    startYear,
    endMonth,
    endYear,
    current,
  };
}

export function toImportedJobs(raws: RawJob[]): ImportedJob[] {
  const jobs: ImportedJob[] = [];
  for (const raw of raws) {
    const job = toImportedJob(raw, jobs.length);
    if (job) jobs.push(job);
    if (jobs.length >= MAX_IMPORTED_JOBS) break;
  }
  return jobs;
}

const MONTH_ABBREVIATIONS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseLinkedInDate(value: string): { year: number | null; month: number | null } | null {
  const text = value.trim();
  if (!text) return null;
  const yearOnly = /^(\d{4})$/.exec(text);
  if (yearOnly) return { year: Number(yearOnly[1]), month: null };
  const named = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTH_ABBREVIATIONS.indexOf(named[1].toLowerCase()) + 1;
    return { year: Number(named[2]), month: month || null };
  }
  return { year: null, month: null };
}

const REQUIRED_HEADERS = ["company name", "title", "description", "location", "started on", "finished on"];

/** Parses LinkedIn's Positions.csv export. Throws NotPositionsFileError when a
 *  required column is missing. papaparse loads on demand so it stays out of the
 *  profile bundle. */
export async function parseLinkedInPositionsCsv(text: string): Promise<ImportedJob[]> {
  const { default: Papa } = await import("papaparse");
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const fields = result.meta.fields ?? [];
  if (!REQUIRED_HEADERS.every((h) => fields.includes(h))) throw new NotPositionsFileError();

  const raws: RawJob[] = result.data.map((row) => {
    const start = parseLinkedInDate(row["started on"] ?? "");
    const endText = (row["finished on"] ?? "").trim();
    const end = endText ? parseLinkedInDate(endText) : null;
    return {
      company: row["company name"],
      position: row["title"],
      description: row["description"],
      location: row["location"],
      start,
      end,
      current: endText === "",
    };
  });
  return toImportedJobs(raws);
}

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s(inc|llc|corp|ltd)$/, "")
    .trim();
}

export function isDuplicate(job: Pick<ImportedJob, "company" | "startMonth">, existing: Pick<WorkExperienceItem, "company" | "startMonth">[]): boolean {
  const company = normalizeCompany(job.company);
  return existing.some((e) => normalizeCompany(e.company) === company && e.startMonth === job.startMonth);
}

export type SavePayload = {
  company: string;
  position: string;
  description: string;
  location: string;
  workMode: string;
  startMonth: string;
  endMonth: string;
};

/** The field shape parseWorkExperience reads. */
export function toSavePayload(job: ImportedJob): SavePayload {
  return {
    company: job.company,
    position: job.position,
    description: job.description ?? "",
    location: job.location ?? "",
    workMode: job.workMode ?? "",
    startMonth: job.startMonth,
    endMonth: job.current ? "" : job.endMonth,
  };
}

/** What blocks a job from being added until the member fixes it. A known end
 *  year without a month would otherwise save as a current job. */
export function jobIssue(job: Pick<ImportedJob, "startMonth" | "endMonth" | "endYear" | "current">): string | null {
  if (monthToDate(job.startMonth) === null) return "Pick a start month";
  if (!job.current && job.endMonth === "" && job.endYear !== null) return "Pick an end month";
  return null;
}
