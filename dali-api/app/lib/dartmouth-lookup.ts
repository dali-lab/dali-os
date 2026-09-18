// Dartmouth directory-lookup client — lookup.dartmouth.edu/api/search.
//
// ⚠️  REACHABILITY NOTE (2026-07-06): The web root of lookup.dartmouth.edu
// redirects to saml2/authenticate (SSO-gated). However, the open JSON
// path /api/search has NOT been verified server-side. This module is
// written for the BetterAuth migration exploration (see specs/betterauth-
// migration.md). Confirm reachability of /api/search from Fly.io before
// shipping. If it too is SSO-gated, the fallback is validateSelfEnteredNetId
// (which uses the authenticated People API).
//
// Role: turn a person's NAME into their Dartmouth netID at sign-up, so we
// can (a) capture netID and (b) classify Dartmouth affiliation for routing.
// This replaces the netID signal that CAS used to hand us.
//
// Binding is conservative: bindNetIdByEmail() will only return a match when
// the candidate record's mail matches the caller's VERIFIED email (Google
// OAuth / institutional SSO). A wrong netID is a wrong payroll identity, so
// name-only matches are never surfaced.

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
// ⚠️  UNVERIFIED WIRE FORMAT — all field names and envelope shapes below are
// ASSUMED based on common LDAP-over-HTTP conventions at Dartmouth. They have
// NOT been confirmed against a live /api/search response. This function is the
// SINGLE place to fix when the real format is known. Every assumption is
// called out inline.
//
// Assumed response shapes (defensive — we accept all three):
//   1. Top-level array:       [ { uid, mail, eduPersonPrimaryAffiliation, dcDeptclass }, … ]
//   2. { users: [ … ] }       envelope
//   3. { results: [ … ] }     envelope
//
// Assumed per-record fields:
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
    // Assumed field name: eduPersonPrimaryAffiliation (standard eduPerson LDAP attr).
    const affiliation =
      typeof r.eduPersonPrimaryAffiliation === "string" &&
      r.eduPersonPrimaryAffiliation.trim() !== ""
        ? r.eduPersonPrimaryAffiliation.trim()
        : null;
    // Assumed field name: dcDeptclass (Dartmouth-custom LDAP attr).
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
 * Search the Dartmouth directory by display name. Returns all matching records.
 * Blank/whitespace-only names return [] without hitting the network.
 * 404 → [] (no match). Other non-OK → throws.
 */
export async function searchDirectoryByName(
  name: string,
): Promise<DirectoryMatch[]> {
  if (!name || name.trim() === "") return [];

  const url = `${LOOKUP_BASE_URL}?query=${encodeURIComponent(name.trim())}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(
      `dartmouth-lookup: HTTP ${res.status} ${res.statusText} for query="${name}"`,
    );
  }

  return parseDirectoryResponse(await res.json());
}

/**
 * Look up a person by name and bind their netID only when the directory record
 * mail EXACTLY matches (case-insensitively) the caller's verified email.
 *
 * Returns the first such match, or null if no record's mail matches.
 * NEVER returns a name-only match — an unmatched name is a security risk
 * (wrong netID = wrong payroll identity).
 */
export async function bindNetIdByEmail(
  name: string,
  verifiedEmail: string,
): Promise<DirectoryMatch | null> {
  const normalizedEmail = verifiedEmail.trim().toLowerCase();
  const matches = await searchDirectoryByName(name);

  for (const match of matches) {
    if (match.mail !== null && match.mail === normalizedEmail) {
      return match;
    }
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
