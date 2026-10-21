export type TrackerTopLevelStage = "ApplicationOpen" | "ApplicationsClosed" | "Pending" | "Draft" | "Withdrawn";

/** The whole-page state on /portal/hiring, or null when per-domain cards carry it. */
export function trackerTopLevelStage(args: {
  applicationStatus: string | null;
  domainApplicationCount: number;
  hasApplication: boolean;
  allDomainsClosed: boolean;
  cycleStatus: string | null;
}): TrackerTopLevelStage | null {
  const { applicationStatus, domainApplicationCount, hasApplication, allDomainsClosed, cycleStatus } = args;
  if (applicationStatus === "Withdrawn") return "Withdrawn";
  if (domainApplicationCount === 0) {
    if (applicationStatus === "Submitted") return "Pending";
    if (!hasApplication) return allDomainsClosed ? "ApplicationsClosed" : "ApplicationOpen";
    return null;
  }
  if (applicationStatus === "Draft") return cycleStatus === "Open" ? "Draft" : "ApplicationsClosed";
  return null;
}
