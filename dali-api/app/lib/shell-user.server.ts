// The user row the app shell needs on every navigation: sidebar avatar, the
// display timezone, whether a Google calendar is linked (tour step), and the
// onboarding/tour flags. The Home loader needs the timezone from this same row.
//
// Both loaders run concurrently for one navigation, so this is memoized on the
// Request — whichever loader reaches it first issues the single query and the
// other awaits it, turning what used to be two separate lookups (one of them a
// serial hop before Home's parallel block) into one shared read.

import { prisma } from "~/lib/db";
import { cachedForRequest } from "~/lib/request-cache";

const SHELL_USER_SELECT = {
  photoUrl: true,
  timeZone: true,
  calendarLinks: {
    where: { provider: "Google", enabled: true },
    select: { id: true },
    take: 1,
  },
  daliMember: {
    select: {
      onboardedAt: true,
      tourCompletedAt: true,
      // Resumable guide: the shell renders the guide card on every page, so it
      // needs the cleared-step list in the read it already makes.
      guideStepIds: true,
    },
  },
} as const;

export type ShellUser = {
  photoUrl: string | null;
  timeZone: string | null;
  calendarLinks: { id: string }[];
  daliMember: {
    onboardedAt: Date | null;
    tourCompletedAt: Date | null;
    guideStepIds: string[];
  } | null;
};

export function loadShellUser(
  userId: string,
  request: Request,
): Promise<ShellUser | null> {
  return cachedForRequest(request, `shellUser:${userId}`, () =>
    prisma.user.findUnique({ where: { id: userId }, select: SHELL_USER_SELECT }),
  );
}
