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
 * The single close date worth showing for a cycle: the applicant's own
 * deadline (latest across `selectedDomainIds`, when given and non-empty), or
 * the latest across every ready domain otherwise. `earlierDomainsExist` is
 * true when some ready domain's effective close is earlier than that date —
 * the caller's cue to add a "some domains close earlier" qualifier, since the
 * single date shown is otherwise the latest, not the only, deadline.
 */
export function cycleDeadlineSummary(
  domains: DomainWindowWithId[],
  cycle: CycleWindow,
  selectedDomainIds?: Iterable<string> | null,
): { closeDate: Date | null; earlierDomainsExist: boolean } {
  const selected = selectedDomainIds ? new Set(selectedDomainIds) : null;
  const relevant = selected && selected.size > 0 ? domains.filter((d) => selected.has(d.domainId)) : domains;
  const closeDate = latestCloseDate(relevant, cycle);
  const earlierDomainsExist =
    closeDate !== null &&
    domains.some((d) => {
      const close = domainCloseDate(d, cycle);
      return close !== null && close.getTime() < closeDate.getTime();
    });
  return { closeDate, earlierDomainsExist };
}
