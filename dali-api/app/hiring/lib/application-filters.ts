import { matchesAllWords } from "~/lib/person-search";
import { readSortParams, writeSortParams } from "~/lib/sort-params";

// Client-side view state for the Applications list. Lives apart from the
// route module so it can be tested without loading the loader's Prisma client.

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
};

export const APPLICATION_SORT_COLUMNS = [
  { key: "name", label: "Applicant" },
  { key: "domain", label: "Domain" },
  { key: "status", label: "Status" },
  { key: "submittedAt", label: "Submitted" },
  { key: "reviewers", label: "Reviewers" },
  { key: "interviewers", label: "Interviewers" },
] as const;
export type ApplicationSortKey = (typeof APPLICATION_SORT_COLUMNS)[number]["key"];
export type ApplicationSort = { key: ApplicationSortKey; dir: "asc" | "desc" };

export const DEFAULT_SORT: ApplicationSort = { key: "name", dir: "asc" };

// While a cycle is under review the table tracks who is on each applicant;
// otherwise it shows when they submitted.
export function applicationColumns(cycleStatus: string) {
  const keys: ApplicationSortKey[] =
    cycleStatus === "UnderReview"
      ? ["name", "domain", "status", "reviewers", "interviewers"]
      : ["name", "domain", "status", "submittedAt"];
  return APPLICATION_SORT_COLUMNS.filter((c) => keys.includes(c.key));
}

// A remembered sort on a column the current cycle doesn't show falls back to
// the default rather than ordering rows by something invisible.
export function visibleSort(
  sort: ApplicationSort,
  columns: readonly { key: ApplicationSortKey }[],
): ApplicationSort {
  return columns.some((c) => c.key === sort.key) ? sort : DEFAULT_SORT;
}

// The list view lives in the URL: repeated params for multi-picks, `pie=all`
// for the in-progress toggle, and the sort via sort-params.
const LIST_PARAMS = {
  domainIds: "domain",
  statuses: "status",
  engagement: "engagement",
  eventIds: "event",
} as const;

// Ids and stages picked from one cycle's data; they mean nothing in another.
export const CYCLE_SCOPED_PARAMS = ["domain", "status", "stage", "engagement", "event"];

const isEngagement = (v: string): v is EngagementFilter =>
  ENGAGEMENT_FILTERS.some((e) => e.key === v);
const SORT_KEYS = APPLICATION_SORT_COLUMNS.map((c) => c.key);

export function filtersFromParams(params: URLSearchParams): ApplicationFilters {
  return {
    domainIds: params.getAll(LIST_PARAMS.domainIds),
    statuses: params.getAll(LIST_PARAMS.statuses),
    stage: params.get("stage") || null,
    engagement: params.getAll(LIST_PARAMS.engagement).filter(isEngagement),
    eventIds: params.getAll(LIST_PARAMS.eventIds),
    pieIncludesInProgress: params.get("pie") === "all",
  };
}

export function sortFromParams(params: URLSearchParams): ApplicationSort {
  return readSortParams(params, SORT_KEYS, DEFAULT_SORT);
}

export function writeViewParams(
  prev: URLSearchParams,
  next: Partial<ApplicationFilters> & { sort?: ApplicationSort },
): URLSearchParams {
  let params = new URLSearchParams(prev);
  for (const field of Object.keys(LIST_PARAMS) as (keyof typeof LIST_PARAMS)[]) {
    const values = next[field];
    if (values === undefined) continue;
    params.delete(LIST_PARAMS[field]);
    for (const v of values) params.append(LIST_PARAMS[field], v);
  }
  if (next.stage !== undefined) {
    if (next.stage) params.set("stage", next.stage);
    else params.delete("stage");
  }
  if (next.pieIncludesInProgress !== undefined) {
    if (next.pieIncludesInProgress) params.set("pie", "all");
    else params.delete("pie");
  }
  if (next.sort) params = writeSortParams(params, next.sort, DEFAULT_SORT);
  return params;
}

type SortableApplication = {
  name: string;
  domain: string;
  status: string;
  submittedAt: string | null;
  reviewers: string | null;
  interviewers: string | null;
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
    return sign * x.localeCompare(y);
  });
}

export function matchesApplicationQuery(
  row: { name: string; email: string | null },
  query: string,
): boolean {
  return matchesAllWords(`${row.name} ${row.email ?? ""}`, query);
}
