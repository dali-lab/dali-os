import { prisma } from "~/lib/db";
import { displayEmail } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { isValidTimezone } from "~/lib/timezone";

// The applicant-portal profile: one load/save pair shared by the portal home
// (where the profile is the landing card) and /portal/settings. CAS hands us
// legal names, so editable first/last (preferred name), pronouns, and a phone
// number for interview scheduling are the fields that matter.
//
// The sign-in address is deliberately NOT editable here. daliEmail /
// dartmouthEmail / personalEmail are auth identities — the Google callback and
// the partner magic link both resolve an account by them — so a self-service
// text field would let anyone claim someone else's sign-in address.

export type PortalProfileFields = {
  firstName: string;
  lastName: string;
  pronouns: string | null;
  phoneNumber: string | null;
  classYear: number | null;
  major: string | null;
  timeZone: string | null;
  photoUrl: string | null;
};

export type PortalProfileData = {
  profile: PortalProfileFields;
  /** Read-only: the address they sign in with. */
  email: string;
  userId: string;
  photoPreviewUrl: string | null;
};

export async function loadPortalProfile(
  userId: string,
): Promise<PortalProfileData | null> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      pronouns: true,
      phoneNumber: true,
      classYear: true,
      major: true,
      timeZone: true,
      photoUrl: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      netId: true,
    },
  });
  if (!me) return null;
  const { daliEmail, dartmouthEmail, personalEmail, netId, ...profile } = me;
  return {
    profile,
    email: displayEmail(me),
    userId,
    photoPreviewUrl: await resolvePhotoUrl(me.photoUrl),
  };
}

export async function savePortalProfile(
  userId: string,
  form: FormData,
): Promise<{ ok: true } | { error: string }> {
  // The hero avatar (ProfilePhotoAvatar) saves on its own the moment a crop is
  // confirmed, rather than waiting for the Profile section's Save.
  if (form.get("intent") === "update-photo") {
    await prisma.user.update({
      where: { id: userId },
      data: { photoUrl: (form.get("photoUrl") as string | null)?.trim() || null },
    });
    return { ok: true };
  }

  const firstName = (form.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (form.get("lastName") as string | null)?.trim() ?? "";
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  const classYearRaw = (form.get("classYear") as string | null)?.trim();
  const classYear = classYearRaw ? Number.parseInt(classYearRaw, 10) : null;
  if (classYearRaw && (Number.isNaN(classYear!) || classYear! < 2000 || classYear! > 2100)) {
    return { error: "Enter a valid class year (e.g. 2027)." };
  }
  const tzRaw = (form.get("timeZone") as string | null)?.trim() || null;
  const timeZone = tzRaw && isValidTimezone(tzRaw) ? tzRaw : null;
  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName,
      lastName,
      pronouns: (form.get("pronouns") as string | null)?.trim() || null,
      phoneNumber: (form.get("phoneNumber") as string | null)?.trim() || null,
      classYear,
      major: (form.get("major") as string | null)?.trim() || null,
      timeZone,
      // Only the form that actually carries the photo field may clear it. The
      // profile home has no photo input — its hero avatar owns the photo — so
      // without this guard saving the other fields would wipe the portrait.
      ...(form.has("photoUrl")
        ? { photoUrl: (form.get("photoUrl") as string | null)?.trim() || null }
        : {}),
    },
  });
  return { ok: true };
}
