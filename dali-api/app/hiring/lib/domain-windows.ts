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
