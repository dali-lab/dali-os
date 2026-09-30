// Dartmouth directory-lookup client — lookup.dartmouth.edu/api/search.
//
// ⚠️  REACHABILITY (STILL UNCONFIRMED FROM OUR SERVERS): the web root of
// lookup.dartmouth.edu is SSO-gated, and /api/search answers from a Dartmouth
// network but 302s from at least one off-campus host. Confirm from a Fly
// machine before trusting any of this in prod — a 302 followed to an HTML
// login page makes res.json() throw, which every caller must now surface
// rather than swallow (see DirectoryLookupError).
//
// Role: resolve between the two things Dartmouth knows about a person —
// their netID and their real mail address. Both directions are needed:
//
//   netID → mail   repairing rows whose only address is the NetID-form one
//                  CAS synthesized (?query=<netid> matches on uid)
//   mail  → netID  capturing a netID at sign-up now that CAS is gone
//
// The second direction has no direct support: the endpoint indexes uid and
// name, NOT mail, so querying an address returns 404. It is done by searching
// candidate NAMES and keeping only a record whose mail equals the address the
// person already proved. That equality is the security boundary — a wrong
// netID is a wrong payroll identity — so widening the name search is safe
// while relaxing the mail check never is.

import {
  parseDepartmentClass,
  graduateProgramLabel,
} from "~/lib/dartmouth-people";
import type { DartmouthPeopleResult } from "~/lib/dartmouth-people";
import { peopleByNetId } from "~/lib/dartmouth-people";

const LOOKUP_BASE_URL = "https://lookup.dartmouth.edu/api/search";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type DirectoryMatch = {
  /** Lowercased, trimmed netID (from uid). */
  netId: string;
  /** Lowercased, trimmed email (from mail), or null if absent. */
  mail: string | null;
  /** Raw eduPersonPrimaryAffiliation, e.g. "Student" | "Staff" | "Faculty". */
  affiliation: string | null;
  /** Raw dcDeptclass: "'27", "GR", "TH", "TU27", "DM", or a dept name. */
  departmentClass: string | null;
  /** Parsed undergrad class year (parseDepartmentClass(departmentClass)). */
  classYear: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Wire-format parser
//
// Wire format CONFIRMED 2026-09-30 against a live /api/search response:
//
//   {"status":"200","users":[{"uid":"d99999z","dcAffiliation":"DART",
//    "eduPersonPrimaryAffiliation":"Student","dcHinmanaddr":"HB 0000",
//    "mail":"alex.t.rivera.27@dartmouth.edu","displayName":"Alex T Rivera",
//    "dcDeptclass":"'27"}],"truncated":false}
//
// The fixture in __tests__ is that exact payload. Note `mail` arrives in mixed
// case and is lowercased here; `truncated` reports that the result set was cut,
// which matters when a broad surname query is used as a fallback.
//
// Response shapes (defensive — we accept all three):
//   1. Top-level array:       [ { uid, mail, eduPersonPrimaryAffiliation, dcDeptclass }, … ]
//   2. { users: [ … ] }       envelope
//   3. { results: [ … ] }     envelope
//
// Per-record fields:
//   uid                          — netID string (REQUIRED; record skipped if absent)
//   mail                         — email address string (optional)
//   eduPersonPrimaryAffiliation  — "Student" | "Staff" | "Faculty" (optional)
//   dcDeptclass                  — class/dept string, e.g. "'27", "GR", "ArtSci DALI Lab" (optional)
// ─────────────────────────────────────────────────────────────────────────────

type RawDirectoryRecord = {
  uid?: unknown;
  mail?: unknown;
  eduPersonPrimaryAffiliation?: unknown;
  dcDeptclass?: unknown;
};

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  // Assumed envelope: { users: [...] }
  if (
    raw !== null &&
    typeof raw === "object" &&
    "users" in raw &&
    Array.isArray((raw as Record<string, unknown>).users)
  ) {
    return (raw as Record<string, unknown>).users as unknown[];
  }
  // Assumed envelope: { results: [...] }
  if (
    raw !== null &&
    typeof raw === "object" &&
    "results" in raw &&
    Array.isArray((raw as Record<string, unknown>).results)
  ) {
    return (raw as Record<string, unknown>).results as unknown[];
  }
  return [];
}

function parseDirectoryResponse(raw: unknown): DirectoryMatch[] {
  const records = extractArray(raw);
  const matches: DirectoryMatch[] = [];

  for (const record of records) {
    if (record === null || typeof record !== "object") continue;
    const r = record as RawDirectoryRecord;

    // uid is REQUIRED — skip records without it.
    if (typeof r.uid !== "string" || r.uid.trim() === "") continue;

    const netId = r.uid.trim().toLowerCase();
    const mail =
      typeof r.mail === "string" && r.mail.trim() !== ""
        ? r.mail.trim().toLowerCase()
        : null;
    const affiliation =
      typeof r.eduPersonPrimaryAffiliation === "string" &&
      r.eduPersonPrimaryAffiliation.trim() !== ""
        ? r.eduPersonPrimaryAffiliation.trim()
        : null;
    const departmentClass =
      typeof r.dcDeptclass === "string" && r.dcDeptclass.trim() !== ""
        ? r.dcDeptclass.trim()
        : null;

    matches.push({
      netId,
      mail,
      affiliation,
      departmentClass,
      classYear: parseDepartmentClass(departmentClass),
    });
  }

  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A lookup that could not be completed — transport failure, an SSO redirect
 * landing on HTML, or an unparseable body. Distinct from "no such person" (an
 * empty array) so callers can tell "this person has no netID" from "we never
 * got to ask". Conflating the two is how netID capture can fail in total
 * silence.
 */
export class DirectoryLookupError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DirectoryLookupError";
  }
}

/**
 * Raw ?query= against the directory. The endpoint matches on uid and on name;
 * it does NOT index mail, so an address returns 404 (confirmed 2026-09-30).
 *
 * Blank queries return [] without hitting the network. 404 → [] (no match).
 * Anything else that stops us reading records throws DirectoryLookupError.
 */
export async function searchDirectory(query: string): Promise<DirectoryMatch[]> {
  if (!query || query.trim() === "") return [];

  const url = `${LOOKUP_BASE_URL}?query=${encodeURIComponent(query.trim())}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  } catch (err) {
    throw new DirectoryLookupError(`dartmouth-lookup: request failed for query="${query}"`, err);
  }

  if (res.status === 404) return [];
  if (!res.ok) {
    throw new DirectoryLookupError(
      `dartmouth-lookup: HTTP ${res.status} ${res.statusText} for query="${query}"`,
    );
  }

  // An SSO gate answers 200 with an HTML login page, which lands here rather
  // than in the !res.ok branch above. Parsing is what catches it.
  try {
    return parseDirectoryResponse(await res.json());
  } catch (err) {
    throw new DirectoryLookupError(
      `dartmouth-lookup: unparseable response for query="${query}" (SSO gate?)`,
      err,
    );
  }
}

/**
 * Search the Dartmouth directory by display name. Returns all matching records.
 */
export async function searchDirectoryByName(name: string): Promise<DirectoryMatch[]> {
  return searchDirectory(name);
}

/**
 * The record for a known netID. Exact: the endpoint matches uid, and we keep
 * only the record whose uid IS the netID, so a partial hit can never stand in
 * for the person we asked about.
 *
 * This is the direction that repairs an existing row — we already hold the
 * netID, and `mail` is the address the person actually uses.
 */
export async function findDirectoryByNetId(netId: string): Promise<DirectoryMatch | null> {
  const wanted = netId.trim().toLowerCase();
  if (wanted === "") return null;
  const matches = await searchDirectory(wanted);
  return matches.find((m) => m.netId === wanted) ?? null;
}

/**
 * Candidate name queries derived from a Dartmouth address, narrowest first.
 *
 * Dartmouth name-form addresses encode the name (First.M.Last.YY), which is
 * what lets sign-up capture a netID without asking the person to type their
 * name — a nickname or a dropped middle initial silently killed the lookup
 * when the query came from user input.
 *
 * Widening is safe because nothing binds without exact mail equality: a
 * broader query can only surface the right record among more rows, never
 * authorize a wrong one. Narrowest first so a common surname is the last
 * resort, since a broad query is the one at risk of `truncated`.
 */
export function queriesFromDartmouthEmail(email: string): string[] {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  let parts = local.split(".").filter((p) => p !== "");
  // Trailing class year ("27" in alex.t.rivera.27@dartmouth.edu) is not part of the name.
  if (/^\d{2}$/.test(parts[parts.length - 1] ?? "")) parts = parts.slice(0, -1);
  if (parts.length === 0) return [];
  // A single token is either a netID-form address or an unsplittable local
  // part; either way it is its own best query (a netID matches on uid).
  if (parts.length === 1) return [parts[0]];

  const first = parts[0];
  const last = parts[parts.length - 1];
  return [...new Set([parts.join(" "), `${first} ${last}`, last])];
}

/**
 * Bind a netID from an address whose mailbox the caller has already proven.
 *
 * Tries the queries encoded in the address itself, then the supplied display
 * name, and returns the first record whose mail EXACTLY matches (case
 * insensitively) that address.
 *
 * NEVER returns a name-only match — an unmatched name is a security risk
 * (wrong netID = wrong payroll identity).
 */
export async function bindNetIdByEmail(
  name: string,
  verifiedEmail: string,
): Promise<DirectoryMatch | null> {
  const normalizedEmail = verifiedEmail.trim().toLowerCase();
  const queries = queriesFromDartmouthEmail(normalizedEmail);
  const trimmedName = name.trim();
  if (trimmedName !== "") queries.push(trimmedName);

  // Dedupe case-insensitively: a derived "jane doe" and a supplied "Jane Doe"
  // are the same query and shouldn't cost a second round trip.
  const seen = new Set<string>();
  for (const query of queries) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const matches = await searchDirectory(query);
    const hit = matches.find((m) => m.mail !== null && m.mail === normalizedEmail);
    if (hit) return hit;
  }
  return null;
}

/**
 * Returns true when the match signals Dartmouth student status. Intentionally
 * catches employed grad students — their affiliation may read "Staff" while
 * their dcDeptclass is a grad program code (e.g. "GR"), so we check the
 * affiliation field AND the departmentClass.
 *
 * We use graduateProgramLabel() (the CLOSED set of the four real grad schools —
 * TH/GR/DM/TU) rather than isGraduateProgramClass() (a "has-letters, not a
 * class-year" heuristic). isGraduateProgramClass is only safe in dartmouth-
 * people.ts because those callers pre-gate on the "Student" affiliation; here
 * we deliberately do NOT pre-gate (to catch Staff-affiliated employed grads),
 * so the loose heuristic would mis-flag a plain staffer in a named department
 * ("Computer Science") as a student. The closed-set label distinguishes a grad
 * program CODE from a department NAME.
 */
export function hasStudentSignal(
  match: Pick<DirectoryMatch, "affiliation" | "departmentClass">,
): boolean {
  if (match.affiliation === "Student") return true;
  if (parseDepartmentClass(match.departmentClass) != null) return true;
  if (graduateProgramLabel(match.departmentClass) != null) return true;
  return false;
}

/**
 * Classifies a directory match as a Dartmouth student or non-student.
 * Drives sign-up routing in the BetterAuth flow.
 */
export function classifyDirectoryMatch(
  match: Pick<DirectoryMatch, "affiliation" | "departmentClass">,
): "dartmouth-student" | "dartmouth-nonstudent" {
  return hasStudentSignal(match) ? "dartmouth-student" : "dartmouth-nonstudent";
}

/**
 * Fallback when name-search misses or verifiedEmail binding fails. Lets a
 * user self-enter their netID, which we then confirm exists in the People API.
 *
 * Note: the People API returns affiliation and class year but NOT a display
 * name, so the caller can only confirm existence + affiliation — NOT that the
 * netID belongs to this particular person. Use only as a last-resort hint;
 * authoritative binding still requires a verified-email match.
 */
export async function validateSelfEnteredNetId(
  netId: string,
): Promise<DartmouthPeopleResult | null> {
  return peopleByNetId(netId.trim().toLowerCase());
}
