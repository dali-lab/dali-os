// Email Addresses API client — api.dartmouth.edu/api/email_addresses.
//
// JWT-authenticated against the same host as the People API, which we already
// call in prod, so this avoids the open reachability question hanging over
// lookup.dartmouth.edu (SSO-gated web root; /api/search 302s from some hosts).
//
// Keyed by netid and returns EVERY address Dartmouth holds for a person, which
// is exactly the shape the UserEmail model needs: one person, several working
// addresses, one of them preferred.
//
//   GET /api/email_addresses?netid=d99999z
//
// ⚠️  SCOPE: requires `urn:dartmouth:email_addresses:read.adv`, granted by the
// Advancement IT team against our DARTMOUTH_API_KEY (TDX ticket). Our JWT
// exchange requests no optional scopes today, so until that grant lands these
// calls return 401/403 — surfaced as DartmouthEmailApiError, never as "this
// person has no addresses". Callers must keep a fallback source.
//
// ⚠️  COVERAGE: only the `adv` (Advancement) data source is live. Advancement
// is alumni/donor data, so current enrolled students — the population that
// prompted this work — may be absent or stale. The sis/hrs/idm sources that
// would cover them authoritatively are listed as future enhancements. Treat a
// miss here as "unknown", not as "no such address".

import { getDartmouthJwt } from "~/lib/dartmouth-jwt";

const EMAIL_ADDRESSES_URL = "https://api.dartmouth.edu/api/email_addresses";

export type DartmouthEmailAddress = {
  /** Lowercased, trimmed. */
  address: string;
  /** The netid that owns it, lowercased. */
  netId: string;
  /**
   * Dartmouth's own "this is the person's primary address" signal. Derived
   * from is_primary OR the Advancement preferred markers, because the sample
   * payload carries is_primary: false on every row of a person who plainly has
   * a preferred address — the type/is_preferred_ind pair is the usable signal.
   */
  preferred: boolean;
  /** Raw data_source, e.g. "adv". Kept for diagnosing coverage gaps. */
  dataSource: string | null;
};

/** A call that could not be completed — transport, auth, or an unusable body. */
export class DartmouthEmailApiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DartmouthEmailApiError";
  }
}

type RawEmailAddress = {
  netid?: unknown;
  email_address?: unknown;
  is_primary?: unknown;
  data_source?: unknown;
  data_source_data?: { type?: unknown; is_preferred_ind?: unknown } | null;
};

/** Accept a bare array or a paged envelope — the paging format is unspecified. */
function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw !== null && typeof raw === "object") {
    for (const key of ["data", "results", "items"]) {
      const v = (raw as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function parseEmailAddresses(raw: unknown): DartmouthEmailAddress[] {
  const out: DartmouthEmailAddress[] = [];
  const seen = new Set<string>();

  for (const record of extractArray(raw)) {
    if (record === null || typeof record !== "object") continue;
    const r = record as RawEmailAddress;
    if (typeof r.email_address !== "string" || r.email_address.trim() === "") continue;

    const address = r.email_address.trim().toLowerCase();
    const dsd = r.data_source_data ?? null;
    const preferred =
      r.is_primary === true ||
      dsd?.is_preferred_ind === true ||
      dsd?.type === "Preferred Email";

    // The same address appears once per Advancement type ("Dartmouth Email"
    // and "Preferred Email" are separate rows for one mailbox), so collapse by
    // address and let any row's preferred marker win.
    const existing = seen.has(address)
      ? out.find((e) => e.address === address)
      : undefined;
    if (existing) {
      if (preferred) existing.preferred = true;
      continue;
    }

    seen.add(address);
    out.push({
      address,
      netId: typeof r.netid === "string" ? r.netid.trim().toLowerCase() : "",
      preferred,
      dataSource: typeof r.data_source === "string" ? r.data_source : null,
    });
  }

  return out;
}

/**
 * Every address Dartmouth holds for a netid, deduped, preferred-first.
 *
 * 404 → [] (no addresses on file). Anything that stops us reading records —
 * including a missing scope — throws, so a coverage gap is never mistaken for
 * an authoritative empty answer.
 */
export async function emailAddressesByNetId(
  netId: string,
): Promise<DartmouthEmailAddress[]> {
  const wanted = netId.trim().toLowerCase();
  if (wanted === "") return [];

  const jwt = await getDartmouthJwt();
  const url = `${EMAIL_ADDRESSES_URL}?netid=${encodeURIComponent(wanted)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${jwt}` },
    });
  } catch (err) {
    throw new DartmouthEmailApiError(
      `dartmouth-email-addresses: request failed for netid=${wanted}`,
      err,
    );
  }

  if (res.status === 404) return [];
  if (res.status === 401 || res.status === 403) {
    throw new DartmouthEmailApiError(
      `dartmouth-email-addresses: HTTP ${res.status} for netid=${wanted} — ` +
        `is urn:dartmouth:email_addresses:read.adv granted to this API key?`,
    );
  }
  if (!res.ok) {
    throw new DartmouthEmailApiError(
      `dartmouth-email-addresses: HTTP ${res.status} ${res.statusText} for netid=${wanted}`,
    );
  }

  let parsed: DartmouthEmailAddress[];
  try {
    parsed = parseEmailAddresses(await res.json());
  } catch (err) {
    throw new DartmouthEmailApiError(
      `dartmouth-email-addresses: unparseable response for netid=${wanted}`,
      err,
    );
  }

  // Ignore rows attributed to a different netid; we asked about one person.
  const owned = parsed.filter((e) => e.netId === "" || e.netId === wanted);
  return [...owned].sort((a, b) => Number(b.preferred) - Number(a.preferred));
}
