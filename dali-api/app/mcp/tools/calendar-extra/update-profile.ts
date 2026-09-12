// MCP `update_profile` — self-only profile field edit. Mirrors the profile
// intent from runProfileAction in members/lib/profile-page.server.ts.
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

import { prisma } from "~/lib/db";
import { normalizeHandle } from "~/lib/handle";
import { isValidTimezone } from "~/lib/timezone";
import { McpInvalidError } from "../../registry";

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

// Nullable text fields: input key → Prisma/DB column name (they match).
const NULLABLE_TEXT_FIELDS: Array<keyof Input & string> = [
  "pronouns",
  "linkedinUrl",
  "githubUsername",
  "personalSite",
  "major",
  "hometown",
  "dietaryRestrictions",
  "phoneNumber",
  "photoUrl",
];

export async function runUpdateProfile(userId: string, input: Input) {
  const data: Record<string, string | number | Date | null> = {};
  const updated: Record<string, unknown> = {};

  if (input.firstName !== undefined || input.lastName !== undefined) {
    const firstName = (input.firstName ?? "").trim();
    const lastName = (input.lastName ?? "").trim();
    if (!firstName || !lastName) {
      throw new McpInvalidError("firstName and lastName must both be non-empty if provided");
    }
    data.firstName = firstName;
    data.lastName = lastName;
    updated.firstName = firstName;
    updated.lastName = lastName;
  }

  for (const field of NULLABLE_TEXT_FIELDS) {
    if (input[field] !== undefined) {
      const val = (input[field] as string).trim();
      data[field] = val === "" ? null : val;
      updated[field] = data[field];
    }
  }

  if (input.handle !== undefined) {
    const raw = input.handle.trim();
    const normalized = normalizeHandle(raw);
    data.handle = normalized === "" ? null : normalized;
    updated.handle = data.handle;
  }

  if (input.timezone !== undefined) {
    const tz = input.timezone.trim();
    if (!isValidTimezone(tz)) {
      throw new McpInvalidError("That timezone isn't a recognized IANA zone");
    }
    data.timeZone = tz;
    updated.timezone = tz;
  }

  if (input.classYear !== undefined) {
    data.classYear = input.classYear;
    updated.classYear = input.classYear;
  }

  if (input.personalEmail !== undefined) {
    const val = input.personalEmail.trim();
    if (val !== "" && !val.includes("@")) {
      throw new McpInvalidError("personalEmail looks malformed — must contain @");
    }
    data.personalEmail = val === "" ? null : val;
    updated.personalEmail = data.personalEmail;
  }

  if (input.birthday !== undefined) {
    const raw = input.birthday.trim();
    if (raw === "") {
      data.birthday = null;
      updated.birthday = null;
    } else {
      const d = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) {
        throw new McpInvalidError("birthday must be a valid date in YYYY-MM-DD format");
      }
      data.birthday = d;
      updated.birthday = raw;
    }
  }

  if (Object.keys(data).length === 0) {
    return { ok: true, updated: {} };
  }

  try {
    await prisma.user.update({ where: { id: userId }, data });
  } catch (e) {
    const err = e as { code?: string; meta?: { target?: string[] | string } } | null;
    if (err?.code === "P2002") {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target : target ? [target] : [];
      if (fields.some((f) => f.includes("handle"))) {
        throw new McpInvalidError("That handle is already taken");
      }
      throw new McpInvalidError("A unique constraint was violated");
    }
    throw e;
  }

  return { ok: true, updated };
}
