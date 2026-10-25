// A domain's application window inside a cycle. A domain added after the
// cycle opened can carry its own close date; every other domain inherits the
// cycle's. Client-safe: pure functions over the two rows' date fields.

type DomainWindow = { closeDate: Date | string | null };
type CycleWindow = { closeDate: Date | string | null };

function asDate(d: Date | string | null): Date | null {
  if (!d) return null;
  return d instanceof Date ? d : new Date(d);
}

/** The instant applications for this domain close, or null when neither the domain nor the cycle has one. */
export function domainCloseDate(domain: DomainWindow, cycle: CycleWindow): Date | null {
  return asDate(domain.closeDate) ?? asDate(cycle.closeDate);
}

/** True once this domain's close has passed, whatever the cycle's status row says. */
export function isDomainClosed(domain: DomainWindow, cycle: CycleWindow, now: Date = new Date()): boolean {
  const close = domainCloseDate(domain, cycle);
  return close !== null && now > close;
}

/** The cycle status as one domain's lead works it: an Open cycle is UnderReview for a domain whose own window has closed. */
export function domainReviewStatus<S extends string | null>(
  cycleStatus: S,
  domain: DomainWindow,
  cycle: CycleWindow,
  now: Date = new Date(),
): S | "UnderReview" {
  return cycleStatus === "Open" && isDomainClosed(domain, cycle, now) ? "UnderReview" : cycleStatus;
}

/** Whether a domain lead can assign reviewers in this status. */
export function canAssignReviewersIn(status: string | null): boolean {
  return status === "Open" || status === "UnderReview";
}

/** The latest close among the given domains: an applicant's own deadline when passed their selected domains. */
export function latestCloseDate(domains: DomainWindow[], cycle: CycleWindow): Date | null {
  let latest: Date | null = null;
  for (const d of domains) {
    const close = domainCloseDate(d, cycle);
    if (close && (!latest || close > latest)) latest = close;
  }
  return latest;
}

/** When the cycle as a whole stops taking applications: the last of its ready domains' closes, or the cycle's own close when it has none. */
export function cycleCloseDate(readyDomains: DomainWindow[], cycle: CycleWindow): Date | null {
  if (readyDomains.length === 0) return asDate(cycle.closeDate);
  if (readyDomains.some((d) => domainCloseDate(d, cycle) === null)) return null;
  return latestCloseDate(readyDomains, cycle);
}

/** The earliest close among the given domains — the conservative choice when
 *  a single date must stand in for several domains with different windows
 *  (the public site's one-`closeDate`-field fallback). Null when none close. */
export function earliestCloseDate(domains: DomainWindow[], cycle: CycleWindow): Date | null {
  let earliest: Date | null = null;
  for (const d of domains) {
    const close = domainCloseDate(d, cycle);
    if (close && (!earliest || close < earliest)) earliest = close;
  }
  return earliest;
}

type DomainWindowWithId = DomainWindow & { domainId: string };

/**
 * The applicant's own deadline: the latest close among their selected domains
 * still taking applications, or, when none of theirs is open (or nothing is
 * selected), the latest among every open domain, the ones they could still add.
 * Null once every domain has closed. With no ready domains, the cycle's own close.
 */
export function applicantDeadline(
  domains: DomainWindowWithId[],
  cycle: CycleWindow,
  selectedDomainIds?: Iterable<string> | null,
  now: Date = new Date(),
): Date | null {
  if (domains.length === 0) return asDate(cycle.closeDate);
  const open = domains.filter((d) => !isDomainClosed(d, cycle, now));
  const selected = new Set(selectedDomainIds ?? []);
  const mine = open.filter((d) => selected.has(d.domainId));
  return latestCloseDate(mine.length > 0 ? mine : open, cycle);
}

/**
 * The single close date worth showing for a cycle (`applicantDeadline`), and
 * whether some other open domain closes earlier than it: the caller's cue to
 * add a "some domains close earlier" qualifier.
 */
export function cycleDeadlineSummary(
  domains: DomainWindowWithId[],
  cycle: CycleWindow,
  selectedDomainIds?: Iterable<string> | null,
  now: Date = new Date(),
): { closeDate: Date | null; earlierDomainsExist: boolean } {
  const closeDate = applicantDeadline(domains, cycle, selectedDomainIds, now);
  const earlierDomainsExist =
    closeDate !== null &&
    domains.some((d) => {
      const close = domainCloseDate(d, cycle);
      return close !== null && close > now && close.getTime() < closeDate.getTime();
    });
  return { closeDate, earlierDomainsExist };
}
