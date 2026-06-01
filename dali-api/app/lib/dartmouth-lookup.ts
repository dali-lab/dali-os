// Public lookup.dartmouth.edu directory client.
//
// Unauthenticated GET — only requires a Referer header that the upstream
// accepts. Returns currently-affiliated accounts (Student / Staff / Faculty).
// Alumni do NOT appear here; absence-from-lookup is a weak signal we don't
// act on alone.
//
// Used as the "still a student" negative override in alumni derivation:
// when this returns affiliation=Student we know the user is *not* alumni
// regardless of what classYear math would say (5th-year case).

const LOOKUP_URL = "https://lookup.dartmouth.edu/api/search";
const REFERER = "https://lookup.dartmouth.edu/";

export type DartmouthLookupAffiliation = "Student" | "Staff" | "Faculty";

export type DartmouthLookupResult = {
  affiliation: DartmouthLookupAffiliation | null;
  classYear: number | null;
};

type RawUser = {
  uid?: string;
  eduPersonPrimaryAffiliation?: string;
  dcDeptclass?: string;
};

type RawResponse = {
  status?: string;
  users?: RawUser[];
};

// Parse the apostrophe-prefixed two-digit class year format used by the
// lookup endpoint (e.g. "'27" → 2027). Returns null when the field is a
// department string (Faculty/Staff) or otherwise unparseable.
export function parseDcDeptclass(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^'(\d{2})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // Two-digit window: '00–'89 → 2000-2089, '90–'99 → 1990-1999. Generous on
  // both sides because Dartmouth currently lists no one outside this band,
  // and we'd rather be wrong by a century once than miss a real grad.
  return n >= 90 ? 1900 + n : 2000 + n;
}

function normalizeAffiliation(
  raw: string | undefined,
): DartmouthLookupAffiliation | null {
  if (raw === "Student" || raw === "Staff" || raw === "Faculty") return raw;
  return null;
}

export async function lookupByNetId(
  netId: string,
): Promise<DartmouthLookupResult | null> {
  const url = `${LOOKUP_URL}?query=${encodeURIComponent(netId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Referer: REFERER },
  });

  if (!res.ok) {
    throw new Error(
      `dartmouth-lookup: HTTP ${res.status} ${res.statusText} for netId=${netId}`,
    );
  }

  const body = (await res.json()) as RawResponse;
  // Match strictly on uid — searching by netId can collide with names
  // containing the same string. If we don't find an exact uid match the
  // user is treated as absent (alumni / graduated / non-existent).
  const match = body.users?.find(
    (u) => typeof u.uid === "string" && u.uid.toLowerCase() === netId.toLowerCase(),
  );

  if (!match) return null;

  const affiliation = normalizeAffiliation(match.eduPersonPrimaryAffiliation);
  // Only carry classYear for Students. For Staff/Faculty dcDeptclass is the
  // department name, which is not a year and is irrelevant to us.
  const classYear =
    affiliation === "Student" ? parseDcDeptclass(match.dcDeptclass) : null;

  return { affiliation, classYear };
}
