// People API client — api.dartmouth.edu/api/people/{netid}.
//
// JWT-authenticated. Covers all accounts including alumni. This is the
// netid-keyed source for affiliation signals; addresses come from its sibling
// api.dartmouth.edu/api/email_addresses (see dartmouth-email-addresses.ts).
// The unauthenticated name-search directory at lookup.dartmouth.edu was
// retired: it is SSO-gated from some hosts, searches uid and name but not
// mail, and its failures were indistinguishable from an empty result.
//
// Signals we read, all in the base no-scope payload (verified against live
// records on 2026-07-06, and re-verified 2026-09-30 for `email`):
//
//   affiliations[]        "Alum" appears within weeks of degree conferral —
//                         the prompt graduation signal. "Student" LINGERS
//                         after graduation, so enrolled-right-now is the
//                         compound (Student present AND Alum absent).
//   dartmouth_affiliation IDM account code. Stays "DART" for months after
//                         graduation; the eventual "ALUMNI" flip is the
//                         long-tail confirmation, not the fresh signal.
//   department_class      Class identity for students ("'27" → 2027; a
//                         department name for employees). Note this is the
//                         CLASS a person identifies with, not their actual
//                         graduation year — a '25 on a +1 stays "'25".
//   email                 The person's real name-form address
//                         (First.M.Last.YY@dartmouth.edu) — the one they type
//                         and recognise, as opposed to the netid@dartmouth.edu
//                         alias CAS provisioning used to synthesize. Present at
//                         base scope for currently enrolled students, so
//                         resolving a netID to a usable address needs no extra
//                         authorization and no separate Email Addresses API.
//
// Affiliation codes for dartmouth_affiliation (see developer.dartmouth.edu):
//   ALUMNI, DART (student/faculty/staff/ex-employee), E-FAC, DEPT, ORG,
//   P-ADM, SERVICE, SPON, SPONLIM, TRUSTEE.

import { getDartmouthJwt } from "~/lib/dartmouth-jwt";

/** A lookup that could not be completed, as distinct from "no such person". */
export class DartmouthPeopleError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DartmouthPeopleError";
  }
}

const PEOPLE_BASE_URL = "https://api.dartmouth.edu/api/people";

export type DartmouthPeopleResult = {
  /** Raw IDM code, e.g. "DART" | "ALUMNI". */
  dartmouthAffiliation: string | null;
  /** "Alum" ∈ affiliations — degree conferred. */
  isAlum: boolean;
  /** "Student" ∈ affiliations. Lingers post-graduation; on its own this
   * does NOT mean currently enrolled — enrolled is isStudent && !isAlum. */
  isStudent: boolean;
  /** Parsed from department_class when it is a class year ("'27" → 2027);
   * null for employees/unparseable. Class identity, not grad year. */
  classYear: number | null;
  /** Raw department_class: an undergrad class year ("'27"), a grad/professional
   * program code ("TH" Thayer, "GR" Guarini, "DM" Geisel, "TU27" Tuck), or a
   * department name (employees). Persisted so the resolver can tell an enrolled
   * grad student (program code) from a graduated undergrad (class year). */
  departmentClass: string | null;
  /** Lowercased name-form address, or null when the record carries none. */
  email: string | null;
  /** Display name as Dartmouth holds it, for reporting during repairs. */
  name: string | null;
};

// Parse the apostrophe-prefixed two-digit class year format ("'27" → 2027).
// Returns null when the field is a department string (employees) or
// otherwise unparseable.
export function parseDepartmentClass(
  raw: string | undefined | null,
): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^'(\d{2})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // Two-digit window: '00–'89 → 2000-2089, '90–'99 → 1990-1999. Generous on
  // both sides because Dartmouth currently lists no one outside this band,
  // and we'd rather be wrong by a century once than miss a real grad.
  return n >= 90 ? 1900 + n : 2000 + n;
}

// A department_class carrying a letter is a graduate/professional PROGRAM code
// ("TH" Thayer, "GR" Guarini, "DM" Geisel, "TU27" Tuck) rather than an
// undergraduate class year ("'27"). A student in one of these programs is
// CURRENTLY ENROLLED; an "Alum" affiliation they ALSO carry is a prior
// Dartmouth degree, not graduation from the program they are in now. Callers
// gate on the "Student" affiliation, so employee department strings — which
// also land in this field — never reach this test in a status decision.
export function isGraduateProgramClass(
  raw: string | undefined | null,
): boolean {
  if (!raw) return false;
  if (parseDepartmentClass(raw) != null) return false; // undergrad class year
  return /[A-Za-z]/.test(raw);
}

// Display label for a grad/professional program code, keyed by its letter
// prefix (department_class can carry a year: "TU27" → Tuck). Null for undergrad
// class years, unknown codes, and employee department names — callers show a
// class year or "—" instead. Kept intentionally conservative: only the four
// Dartmouth graduate/professional schools map, so an unrecognized string never
// surfaces a cryptic code to members.
const GRAD_PROGRAM_LABELS: Record<string, string> = {
  TH: "Thayer",
  GR: "Guarini",
  DM: "Geisel",
  TU: "Tuck",
};

export function graduateProgramLabel(
  raw: string | undefined | null,
): string | null {
  if (!isGraduateProgramClass(raw)) return null;
  const prefix = raw!.trim().match(/^[A-Za-z]+/)?.[0].toUpperCase();
  return (prefix && GRAD_PROGRAM_LABELS[prefix]) ?? null;
}

type RawPerson = {
  dartmouth_affiliation?: string | null;
  affiliations?: { name?: string | null }[] | null;
  department_class?: string | null;
  email?: string | null;
  name?: string | null;
};

export async function peopleByNetId(
  netId: string,
): Promise<DartmouthPeopleResult | null> {
  const jwt = await getDartmouthJwt();
  const url = `${PEOPLE_BASE_URL}/${encodeURIComponent(netId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${jwt}`,
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `dartmouth-people: HTTP ${res.status} ${res.statusText} for netId=${netId}`,
    );
  }

  const body = (await res.json()) as RawPerson;
  const names = (body.affiliations ?? [])
    .map((a) => a?.name)
    .filter((n): n is string => typeof n === "string");

  return {
    dartmouthAffiliation: body.dartmouth_affiliation ?? null,
    isAlum: names.includes("Alum"),
    isStudent: names.includes("Student"),
    classYear: parseDepartmentClass(body.department_class),
    departmentClass: body.department_class ?? null,
    email:
      typeof body.email === "string" && body.email.trim() !== ""
        ? body.email.trim().toLowerCase()
        : null,
    name: typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : null,
  };
}

/**
 * The netid that owns a proven address. This is the direction sign-up needs
 * now that CAS no longer hands us a netID.
 *
 * ⚠️  THE FILTER MUST BE `email`, AND THE RESULT MUST BE RE-CHECKED.
 * Observed 2026-09-30: an unrecognised filter parameter is not rejected. The
 * API ignores it, answers 200, and returns an UNFILTERED list — `?mail=` and
 * `?filter=email eq '...'` both came back with an unrelated staff member as
 * the first record. Taking rows[0] would bind a stranger's netID to someone's
 * account, and netID is payroll identity.
 *
 * So a netid is returned only from a record whose own email IS the address we
 * asked about. If the filter ever stops working, this returns null rather than
 * somebody else.
 */
export async function findNetIdByAddress(address: string): Promise<string | null> {
  const wanted = address.trim().toLowerCase();
  if (wanted === "") return null;

  const jwt = await getDartmouthJwt();
  const url = `${PEOPLE_BASE_URL}?email=${encodeURIComponent(wanted)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${jwt}` },
    });
  } catch (err) {
    throw new DartmouthPeopleError(`dartmouth-people: request failed for ${wanted}`, err);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new DartmouthPeopleError(
      `dartmouth-people: HTTP ${res.status} ${res.statusText} for ${wanted}`,
    );
  }

  let rows: unknown;
  try {
    rows = await res.json();
  } catch (err) {
    throw new DartmouthPeopleError(`dartmouth-people: unparseable response for ${wanted}`, err);
  }
  if (!Array.isArray(rows)) return null;

  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const r = row as { netid?: unknown; email?: unknown };
    if (typeof r.email !== "string" || r.email.trim().toLowerCase() !== wanted) continue;
    if (typeof r.netid === "string" && r.netid.trim() !== "") {
      return r.netid.trim().toLowerCase();
    }
  }
  return null;
}
