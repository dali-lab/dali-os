import { prisma } from "./db";
import { resolvePhotoUrl } from "./photo";
import { primaryEmail } from "~/lib/display";

export interface PresenceUser {
  userId: string;
  name: string;
  photoUrl: string | null;
  subtitle: string | null;
}

// Subtitle convention mirrors the profile page header:
//   "kiran@dali.org · '26"
// Falls back to whichever email column has a value, then class-year alone.
function buildSubtitle(args: {
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
  classYear: number | null;
}): string | null {
  const email = primaryEmail(args) ?? null;
  const yearTail = args.classYear ? `'${String(args.classYear).slice(-2)}` : null;
  if (email && yearTail) return `${email} · ${yearTail}`;
  return email ?? yearTail ?? null;
}

/**
 * Fetch the fields PresenceProvider/PresenceBar need for a given user.
 * Resolves photoUrl through the S3-aware resolver so callers can pass the
 * result straight to the browser.
 */
export async function getPresenceUser(
  userId: string,
  fallbackName?: string,
): Promise<PresenceUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      photoUrl: true,
      classYear: true,
    },
  });
  if (!user) {
    if (!fallbackName) return null;
    return { userId, name: fallbackName, photoUrl: null, subtitle: null };
  }
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    fallbackName ||
    user.daliEmail ||
    user.dartmouthEmail ||
    user.personalEmail ||
    userId;
  const photoUrl = await resolvePhotoUrl(user.photoUrl);
  const subtitle = buildSubtitle({
    daliEmail: user.daliEmail,
    dartmouthEmail: user.dartmouthEmail,
    personalEmail: user.personalEmail,
    classYear: user.classYear,
  });
  return { userId: user.id, name, photoUrl, subtitle };
}
