import { prisma } from "~/lib/db.server";
import { BadRequestError, ConflictError } from "~/lib/http-error";
import { geocodePlace } from "~/lib/geocode.server";
import { normalizeHandle } from "~/lib/handle";
import { uniqueViolationFields } from "~/lib/prisma-errors";
import { isValidTimezone } from "~/lib/timezone";

export type ProfileField =
  | "name"
  | "personalEmail"
  | "timeZone"
  | "classYear"
  | "birthday"
  | "handle"
  | "netId"
  | "unique";

export class ProfileValidationError extends BadRequestError {
  constructor(
    public field: ProfileField,
    message: string,
  ) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

export class ProfileConflictError extends ConflictError {
  constructor(
    public field: "handle" | "netId" | "unique",
    message: string,
  ) {
    super(message);
    this.name = "ProfileConflictError";
  }
}

const NULLABLE_TEXT = [
  "pronouns",
  "major",
  "hometown",
  "currentLocation",
  "linkedinUrl",
  "githubUsername",
  "personalSite",
  "dietaryRestrictions",
  "phoneNumber",
  "photoUrl",
] as const;

export type ProfilePatch = Partial<
  Record<
    | "firstName"
    | "lastName"
    | "timeZone"
    | "handle"
    | "netId"
    | "personalEmail"
    | "birthday"
    | (typeof NULLABLE_TEXT)[number],
    string
  >
> & { classYear?: number | string | null };

export type ProfileUpdateResult = { updated: Record<string, string | number | null> };

export async function updateProfileFields(
  targetId: string,
  patch: ProfilePatch,
  { allowNetId }: { allowNetId: boolean },
): Promise<ProfileUpdateResult> {
  const data: Record<string, string | number | Date | null> = {};
  const updated: ProfileUpdateResult["updated"] = {};
  const trimmed = (v: string) => v.trim();

  if (patch.firstName !== undefined || patch.lastName !== undefined) {
    const firstName = trimmed(patch.firstName ?? "");
    const lastName = trimmed(patch.lastName ?? "");
    if (!firstName || !lastName) {
      throw new ProfileValidationError("name", "First and last name are required.");
    }
    data.firstName = updated.firstName = firstName;
    data.lastName = updated.lastName = lastName;
  }

  for (const field of NULLABLE_TEXT) {
    const raw = patch[field];
    if (raw !== undefined) {
      const val = trimmed(raw);
      data[field] = updated[field] = val === "" ? null : val;
    }
  }

  if (patch.handle !== undefined) {
    const normalized = normalizeHandle(trimmed(patch.handle));
    data.handle = updated.handle = normalized === "" ? null : normalized;
  }

  if (allowNetId && patch.netId !== undefined) {
    const raw = trimmed(patch.netId);
    data.netId = updated.netId = raw === "" ? null : raw.toLowerCase();
  }

  if (patch.personalEmail !== undefined) {
    const val = trimmed(patch.personalEmail);
    if (val !== "" && !val.includes("@")) {
      throw new ProfileValidationError("personalEmail", "Personal email looks malformed.");
    }
    data.personalEmail = updated.personalEmail = val === "" ? null : val;
  }

  if (patch.timeZone !== undefined) {
    const tz = trimmed(patch.timeZone);
    if (tz !== "" && !isValidTimezone(tz)) {
      throw new ProfileValidationError("timeZone", "That timezone isn't a recognized IANA zone.");
    }
    data.timeZone = updated.timeZone = tz === "" ? null : tz;
  }

  if (patch.classYear !== undefined) {
    const raw = typeof patch.classYear === "string" ? patch.classYear.trim() : patch.classYear;
    if (raw === "" || raw === null) {
      data.classYear = updated.classYear = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1900 || n > 2100) {
        throw new ProfileValidationError("classYear", "Class year must be a 4-digit year.");
      }
      data.classYear = updated.classYear = n;
    }
  }

  if (patch.birthday !== undefined) {
    const raw = trimmed(patch.birthday);
    if (raw === "") {
      data.birthday = updated.birthday = null;
    } else {
      const d = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) {
        throw new ProfileValidationError("birthday", "Birthday must be a valid date.");
      }
      data.birthday = d;
      updated.birthday = raw;
    }
  }

  if (Object.keys(data).length === 0) return { updated };

  if (patch.currentLocation !== undefined) {
    const before = await prisma.user.findUnique({
      where: { id: targetId },
      select: { currentLocation: true },
    });
    if ((before?.currentLocation ?? null) !== data.currentLocation) {
      const point =
        typeof data.currentLocation === "string" ? await geocodePlace(data.currentLocation) : null;
      data.currentLocationLat = point?.lat ?? null;
      data.currentLocationLng = point?.lng ?? null;
    }
  }

  try {
    await prisma.user.update({ where: { id: targetId }, data });
  } catch (e) {
    const fields = uniqueViolationFields(e);
    if (fields.some((f) => f.includes("handle"))) {
      throw new ProfileConflictError("handle", "That handle is already taken.");
    }
    if (fields.some((f) => f.includes("netId"))) {
      throw new ProfileConflictError("netId", "That NetID is already on another account.");
    }
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002") {
      throw new ProfileConflictError("unique", "A unique constraint was violated.");
    }
    throw e;
  }

  return { updated };
}
