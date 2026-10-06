// Client-side filter state for the Applications list. Lives apart from the
// route module so it can be validated in tests without loading the loader's
// Prisma client.

export const ENGAGEMENT_FILTERS = [
  { key: "returning", label: "Returning applicant" },
  { key: "emailed", label: "Emailed applications@" },
  { key: "educated", label: "Past DALI education" },
] as const;
export type EngagementFilter = (typeof ENGAGEMENT_FILTERS)[number]["key"];

export type ApplicationFilters = {
  domainIds: string[];
  statuses: string[];
  stage: string | null;
  // Every selected signal must hold (AND), so narrowing stays predictable.
  engagement: EngagementFilter[];
  pieIncludesInProgress: boolean;
  query: string;
};

export const EMPTY_FILTERS: ApplicationFilters = {
  domainIds: [],
  statuses: [],
  stage: null,
  engagement: [],
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
    typeof f.pieIncludesInProgress === "boolean" &&
    typeof f.query === "string"
  );
}
