// People API client — api.dartmouth.edu/api/people/{netid}.
//
// JWT-authenticated. Covers all accounts including alumni, and is the ONLY
// Dartmouth directory source we use: lookup.dartmouth.edu went behind
// Dartmouth SSO (verified 2026-07-06 — even GET / 302s to saml2/authenticate)
// so it is unreachable from our servers.
//
// Three signals, all in the base no-scope payload (verified against live
// records on 2026-07-06 — see alumni_plan.md "Observed API behavior"):
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
//
// Affiliation codes for dartmouth_affiliation (see developer.dartmouth.edu):
//   ALUMNI, DART (student/faculty/staff/ex-employee), E-FAC, DEPT, ORG,
//   P-ADM, SERVICE, SPON, SPONLIM, TRUSTEE.

import { getDartmouthJwt } from "~/lib/dartmouth-jwt";

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

type RawPerson = {
  dartmouth_affiliation?: string | null;
  affiliations?: { name?: string | null }[] | null;
  department_class?: string | null;
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
  };
}
