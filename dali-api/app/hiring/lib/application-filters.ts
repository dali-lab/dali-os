// Client-side filter state for the Applications list. Lives apart from the
// route module so it can be validated in tests without loading the loader's
// Prisma client.

export const ENGAGEMENT_FILTERS = [
  { key: "returning", label: "Returning applicant" },
  { key: "emailed", label: "Emailed applications@" },
  { key: "educated", label: "Past DALI education" },
  { key: "attendedEvent", label: "Attended an event" },
] as const;
export type EngagementFilter = (typeof ENGAGEMENT_FILTERS)[number]["key"];

export type ApplicationFilters = {
  domainIds: string[];
  statuses: string[];
  stage: string | null;
  // Every selected signal must hold (AND), so narrowing stays predictable.
  engagement: EngagementFilter[];
  // Application events (help hours, socials) the applicant attended. Any
  // selected event matches (OR): "came to either help hour" is the question.
  eventIds: string[];
  pieIncludesInProgress: boolean;
  query: string;
};

export const EMPTY_FILTERS: ApplicationFilters = {
  domainIds: [],
  statuses: [],
  stage: null,
  engagement: [],
  eventIds: [],
  pieIncludesInProgress: false,
  query: "",
};

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

export function isApplicationFilters(v: unknown): v is ApplicationFilters {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    isStringList(f.domainIds) &&
    isStringList(f.statuses) &&
    (f.stage === null || typeof f.stage === "string") &&
    isStringList(f.engagement) &&
    f.engagement.every((k) => ENGAGEMENT_FILTERS.some((e) => e.key === k)) &&
    // Missing on filters persisted before events existed; normalised to [] by
    // withFilterDefaults rather than throwing the whole stored state away.
    (f.eventIds === undefined || isStringList(f.eventIds)) &&
    typeof f.pieIncludesInProgress === "boolean" &&
    typeof f.query === "string"
  );
}

export function withFilterDefaults(f: ApplicationFilters): ApplicationFilters {
  return { ...f, eventIds: f.eventIds ?? [] };
}

export const APPLICATION_SORT_COLUMNS = [
  { key: "name", label: "Applicant" },
  { key: "domain", label: "Domain" },
  { key: "status", label: "Status" },
  { key: "submittedAt", label: "Submitted" },
  { key: "reviewCount", label: "Reviews" },
] as const;
export type ApplicationSortKey = (typeof APPLICATION_SORT_COLUMNS)[number]["key"];
export type ApplicationSort = { key: ApplicationSortKey; dir: "asc" | "desc" };

export const DEFAULT_SORT: ApplicationSort = { key: "name", dir: "asc" };

export function isApplicationSort(v: unknown): v is ApplicationSort {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    APPLICATION_SORT_COLUMNS.some((c) => c.key === s.key) &&
    (s.dir === "asc" || s.dir === "desc")
  );
}

type SortableApplication = {
  name: string;
  domain: string;
  status: string;
  submittedAt: string | null;
  reviewCount: number;
};

// The sort is stable, so ties keep the order the rows arrived in (name, then
// domain). Rows with no value sort last in both directions.
export function sortApplications<T extends SortableApplication>(
  rows: T[],
  { key, dir }: ApplicationSort,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (typeof x === "number" ? x - (y as number) : x.localeCompare(y as string));
  });
}
