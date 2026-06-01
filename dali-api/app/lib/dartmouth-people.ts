// People API client — api.dartmouth.edu/api/people/{netid}.
//
// JWT-authenticated. Covers all accounts including alumni — this is how we
// learn someone has officially graduated (their dartmouth_affiliation flips
// from DART to ALUMNI in Dartmouth's IDM).
//
// Affiliation codes (see https://developer.dartmouth.edu, also alumni_plan.md):
//   ALUMNI   — Alumni account
//   DART     — Student, Faculty, Staff, or ExEmployee
//   E-FAC    — Emeritus faculty/staff
//   DEPT     — Departmental account
//   ORG      — Student organization
//   P-ADM    — Private senior-administration account
//   SERVICE  — Service account
//   SPON     — Sponsored account
//   SPONLIM  — Limited sponsored / guest account
//   TRUSTEE  — Trustee
//
// We care chiefly about the ALUMNI vs DART transition.

import { getDartmouthJwt } from "~/lib/dartmouth-jwt";

const PEOPLE_BASE_URL = "https://api.dartmouth.edu/api/people";

export type DartmouthPeopleResult = {
  dartmouthAffiliation: string | null;
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

  const body = (await res.json()) as { dartmouth_affiliation?: string | null };
  return { dartmouthAffiliation: body.dartmouth_affiliation ?? null };
}
