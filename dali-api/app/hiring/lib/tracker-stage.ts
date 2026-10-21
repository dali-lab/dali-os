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

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * The banner over a submitted application while the cycle is Open: edit it
 * when one of the applicant's own domains is still open, otherwise point at
 * the open domains they could still add. Null when there is nothing they can do.
 */
export function submittedEditBanner(args: {
  cycleStatus: string | null;
  applicationStatus: string | null;
  hasOpenSelectedDomain: boolean;
  addableDomainNames: string[];
}): { message: string; cta: string } | null {
  const { cycleStatus, applicationStatus, hasOpenSelectedDomain, addableDomainNames: names } = args;
  if (cycleStatus !== "Open" || applicationStatus !== "Submitted") return null;
  if (hasOpenSelectedDomain) {
    return { message: "The cycle is still open. You can still update your application.", cta: "Edit Application" };
  }
  if (names.length === 0) return null;
  const one = names.length === 1;
  return {
    message: `${joinNames(names)} ${one ? "is" : "are"} still open. You can add ${one ? "it" : "them"} to your application.`,
    cta: one ? `Add ${names[0]}` : "Add a domain",
  };
}
