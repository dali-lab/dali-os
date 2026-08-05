// MCP `update_profile` — self-only profile field edit. Mirrors the profile
// intent from runProfileAction in members/lib/profile-page.server.ts.
// Only the authenticated caller can edit their own profile (no Admin-as-others).
// Requires the `mcp:write` scope.

import { prisma } from "~/lib/db";
import { normalizeHandle } from "~/lib/handle";
import { isValidTimezone } from "~/lib/timezone";
import { syncAvailabilityTimezone } from "~/lib/timezone-preference.server";
import { McpInvalidError } from "../../registry";

export const UPDATE_PROFILE_DEF = {
  name: "update_profile",
  description:
    "Edit your own profile fields. All fields are optional; provide only those you want to change. firstName and lastName must both be non-empty if provided.",
  inputSchema: {
    type: "object" as const,
    properties: {
      firstName: {
        type: "string",
        minLength: 1,
        description: "First name. Must be non-empty if provided.",
      },
      lastName: {
        type: "string",
        minLength: 1,
        description: "Last name. Must be non-empty if provided.",
      },
      pronouns: {
        type: "string",
        description: "Pronouns (e.g. they/them). Empty string clears the field.",
      },
      handle: {
        type: "string",
        description:
          "Short profile handle ([a-z0-9_]). Normalized to lowercase. Empty string clears it.",
      },
      timezone: {
        type: "string",
        description: "IANA timezone (e.g. America/New_York). Must be a valid IANA zone.",
      },
      photoUrl: {
        type: "string",
        description: "Profile photo URL. Empty string clears the current photo.",
      },
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
};

export async function runUpdateProfile(userId: string, input: Input) {
  const data: Record<string, string | null> = {};
  const updated: Record<string, string | null> = {};

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

  if (input.pronouns !== undefined) {
    const val = input.pronouns.trim();
    data.pronouns = val === "" ? null : val;
    updated.pronouns = data.pronouns;
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

  if (input.photoUrl !== undefined) {
    const url = input.photoUrl.trim();
    data.photoUrl = url === "" ? null : url;
    updated.photoUrl = data.photoUrl;
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

  // Keep the calendar/working-hours zone in step with the display zone.
  if (typeof data.timeZone === "string") {
    await syncAvailabilityTimezone(userId, data.timeZone);
  }

  return { ok: true, updated };
}
