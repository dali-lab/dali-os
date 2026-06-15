// Maps a "New Member Profile" form submission's answers onto User profile
// fields. Used by the onboarding flow: an accepted applicant gets a form-backed
// welcome notification whose form collects their personal info; on submit we
// interpret the answers into a User update. Pure (no DB/HTTP) so it's fully
// unit-testable, mirroring projects/lib/bid-form-interpreter.ts.
//
// The onboarding form's questions use well-known KEYS (stable across label
// edits) that map 1:1 to User columns. Unknown keys are ignored; blank answers
// are skipped (left unchanged on the user) rather than nulling existing data.

// The form is identified by this exact name (created/published once via the
// /forms builder). submitMemberForm matches on it to apply this interpreter.
// This name is ALSO the heading the new member sees on the fill page, so it's
// written as a welcome rather than an internal label.
export const NEW_MEMBER_PROFILE_FORM_NAME = "Welcome to DALI! 👋";

// Question key -> User string field. The onboarding form must use these keys.
const STRING_FIELDS: Record<string, string> = {
  "profile.pronouns": "pronouns",
  "profile.major": "major",
  "profile.hometown": "hometown",
  "profile.photoUrl": "photoUrl",
  "profile.githubUsername": "githubUsername",
  "profile.linkedinUrl": "linkedinUrl",
  // Onboarding profile additions.
  "profile.nameOnFile": "nameOnFile",
  // The "College ID" question on the onboarding form is the Dartmouth NetID
  // (single canonical column). Kept under the legacy key so existing form
  // versions don't need re-publishing; the destination column moved to netId.
  "profile.collegeId": "netId",
  "profile.phoneNumber": "phoneNumber",
  "profile.ethnicity": "ethnicity",
  "profile.dietaryRestrictions": "dietaryRestrictions",
};

const CLASS_YEAR_KEY = "profile.classYear";
const BIRTHDAY_KEY = "profile.birthday";

export type ProfileUpdate = {
  pronouns?: string;
  major?: string;
  hometown?: string;
  photoUrl?: string;
  githubUsername?: string;
  linkedinUrl?: string;
  classYear?: number;
  nameOnFile?: string;
  netId?: string;
  phoneNumber?: string;
  ethnicity?: string;
  dietaryRestrictions?: string;
  birthday?: Date;
};

export type ProfileInterpretResult =
  | { ok: true; update: ProfileUpdate }
  | { ok: false; error: string };

function asTrimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Build a User-update partial from the answers. Only non-blank answers are
// written, so submitting a sparse form never wipes fields the member already
// has. classYear is validated as a 4-digit year (mirrors members.$id.tsx).
export function interpretProfileForm(
  answers: Record<string, unknown>,
): ProfileInterpretResult {
  const update: ProfileUpdate = {};

  for (const [key, field] of Object.entries(STRING_FIELDS)) {
    const value = asTrimmed(answers[key]);
    if (value !== "") (update as Record<string, unknown>)[field] = value;
  }

  const classYearRaw = asTrimmed(answers[CLASS_YEAR_KEY]);
  if (classYearRaw !== "") {
    const n = Number(classYearRaw);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      return { ok: false, error: "Class year must be a 4-digit year." };
    }
    update.classYear = n;
  }

  // Birthday: accept a YYYY-MM-DD date string. Store at UTC midnight so there's
  // no timezone drift on a date-only value. Round-trip the parsed components so
  // impossible dates (e.g. 2004-02-31, which Date silently rolls to Mar 2) are
  // rejected rather than quietly shifted.
  const birthdayRaw = asTrimmed(answers[BIRTHDAY_KEY]);
  if (birthdayRaw !== "") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdayRaw);
    const d = m ? new Date(`${birthdayRaw}T00:00:00.000Z`) : null;
    const valid =
      m &&
      d &&
      !Number.isNaN(d.getTime()) &&
      d.getUTCFullYear() === Number(m[1]) &&
      d.getUTCMonth() + 1 === Number(m[2]) &&
      d.getUTCDate() === Number(m[3]);
    if (!valid) {
      return { ok: false, error: "Birthday must be a valid date (YYYY-MM-DD)." };
    }
    update.birthday = d;
  }

  return { ok: true, update };
}
