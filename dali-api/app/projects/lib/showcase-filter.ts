// The Projects hub's "public status" filter.
//
// Pure and separate from the route so the one subtle case has a test: the
// filter's value space is the ProjectShowcaseStatus enum *plus* two values that
// aren't statuses at all — "all" (no filtering) and "none" (projects with no
// showcase row yet, which is the state most projects are in and the one people
// actually search for when deciding what still needs writing up).

export type ShowcaseStatusValue =
  | "NotStarted"
  | "InProgress"
  | "NeedsReview"
  | "Published"
  | "Archive";

/** Filter values accepted from the `?public=` search param. */
export const SHOWCASE_FILTER_ALL = "all";
export const SHOWCASE_FILTER_NONE = "none";

export function matchesShowcaseFilter(
  showcaseStatus: ShowcaseStatusValue | null,
  filter: string,
): boolean {
  if (filter === SHOWCASE_FILTER_ALL) return true;
  if (filter === SHOWCASE_FILTER_NONE) return showcaseStatus === null;
  // An unrecognised value (hand-edited URL) matches nothing rather than
  // silently falling back to "all" — a filter that appears active but isn't
  // would be read as "no projects are published".
  return showcaseStatus === filter;
}
