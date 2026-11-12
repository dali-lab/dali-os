// MCP `update_profile` — self-only profile field edit, on the shared
// updateProfileFields service (members/lib/profile-update.server.ts).
// Only the authenticated caller can edit their own profile (no Admin-as-others).
// Requires the `mcp:write` scope.
//
// Fields exposed here (all safe, same list as TEXT_FIELDS in profile-page.server.ts
// plus classYear and birthday):
//   firstName, lastName, pronouns, handle, timezone, photoUrl,
//   classYear, linkedinUrl, githubUsername, personalSite,
//   major, hometown, birthday, dietaryRestrictions, phoneNumber, personalEmail
//
// Excluded:
//   bio — lives in a Yjs/BlockNote collab doc; edit via the collab layer.
//   netId — CAS-authoritative; editing here risks unique-key conflicts.

import {
  updateProfileFields,
  ProfileConflictError,
  ProfileValidationError,
  type ProfileField,
} from "~/members/lib/profile-update.server";
import { McpInvalidError } from "../../errors";

export const UPDATE_PROFILE_DEF = {
  name: "update_profile",
  description:
    "Edit your own profile fields. All fields are optional; provide only those you want to change. " +
    "firstName and lastName must both be non-empty if either is provided. " +
    "birthday must be YYYY-MM-DD. classYear must be 1900–2100. " +
    "personalEmail must contain @. Empty string clears a nullable field. " +
    "bio is a collaborative document and cannot be changed here.",
  inputSchema: {
    type: "object" as const,
    properties: {
      firstName: { type: "string", minLength: 1, description: "First name. Must be non-empty if provided." },
      lastName: { type: "string", minLength: 1, description: "Last name. Must be non-empty if provided." },
      pronouns: { type: "string", description: "Pronouns (e.g. they/them). Empty string clears." },
      handle: { type: "string", description: "Short profile handle ([a-z0-9_]). Normalized to lowercase. Empty string clears." },
      timezone: { type: "string", description: "IANA timezone (e.g. America/New_York). Must be a valid IANA zone." },
      photoUrl: { type: "string", description: "Profile photo URL. Empty string clears the current photo." },
      classYear: { type: "integer", minimum: 1900, maximum: 2100, description: "4-digit graduation year." },
      linkedinUrl: { type: "string", description: "LinkedIn profile URL. Empty string clears." },
      githubUsername: { type: "string", description: "GitHub username. Empty string clears." },
      personalSite: { type: "string", description: "Personal website URL. Empty string clears." },
      major: { type: "string", description: "Field of study / major. Empty string clears." },
      hometown: { type: "string", description: "Hometown. Empty string clears." },
      birthday: { type: "string", description: "Birthday in YYYY-MM-DD format. Empty string clears." },
      dietaryRestrictions: { type: "string", description: "Dietary restrictions / allergies. Empty string clears." },
      phoneNumber: { type: "string", description: "Phone number. Empty string clears." },
      personalEmail: { type: "string", description: "Personal (non-Dartmouth) email. Must contain @. Empty string clears." },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  firstName?: string;
  lastName?: string;
  pronouns?: string;
  handle?: string;
  timezone?: string;
  photoUrl?: string;
  classYear?: number;
  linkedinUrl?: string;
  githubUsername?: string;
  personalSite?: string;
  major?: string;
  hometown?: string;
  birthday?: string;
  dietaryRestrictions?: string;
  phoneNumber?: string;
  personalEmail?: string;
};

const MESSAGES: Record<ProfileField, string> = {
  name: "firstName and lastName must both be non-empty if provided",
  personalEmail: "personalEmail looks malformed — must contain @",
  timeZone: "That timezone isn't a recognized IANA zone",
  classYear: "classYear must be a 4-digit year between 1900 and 2100",
  birthday: "birthday must be a valid date in YYYY-MM-DD format",
  handle: "That handle is already taken",
  netId: "A unique constraint was violated",
  unique: "A unique constraint was violated",
};

export async function runUpdateProfile(userId: string, input: Input) {
  const { timezone, ...rest } = input;
  try {
    const { updated } = await updateProfileFields(
      userId,
      { ...rest, ...(timezone !== undefined ? { timeZone: timezone } : {}) },
      { allowNetId: false },
    );
    const { timeZone, ...others } = updated;
    return { ok: true, updated: timeZone !== undefined ? { ...others, timezone: timeZone } : others };
  } catch (e) {
    if (e instanceof ProfileValidationError || e instanceof ProfileConflictError) {
      throw new McpInvalidError(MESSAGES[e.field]);
    }
    throw e;
  }
}
