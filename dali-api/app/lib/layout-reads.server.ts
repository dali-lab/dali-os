import { prisma } from "~/lib/db.server";
import { isLabMentor } from "~/lib/roles";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { listFavoritesAndRecents } from "~/lib/user-pages.server";
import { viewerHasUnseenReleaseNotes } from "~/lib/release-notes.server";
import { listVisibleGroupIdsForUser } from "~/lib/groups.server";
import { getAppGateOutstanding } from "~/signing/lib/state.server";
import { getBoundFormGateOutstanding } from "~/forms/lib/gate.server";
import { isNewMemberCohort } from "~/hiring/lib/new-member-cohort.server";
import { cachedForLayout } from "~/lib/layout-cache.server";

// The shell loader's per-user reads, through the layout cache. They can be up
// to a TTL stale (see layout-cache.server.ts), so only the shell calls these.
// The one exception is roles: GET loaders and read-only API routes may use
// `readOnlyRoles`, never actions, never to gate a write, never a `requireX`
// guard.

const cycleKey = (cycleIds: string[]) => [...cycleIds].sort().join(",");

export const layoutRoles = readOnlyRoles;

export function layoutFavorites(userId: string, request: Request) {
  return cachedForLayout(userId, "favorites", () => listFavoritesAndRecents(userId, request));
}

/** Only "nothing owed" is cached: an owed signature always re-checks, so signing lets the user through at once. */
export function layoutAppGate(userId: string, request: Request) {
  return cachedForLayout(userId, "gates", () => getAppGateOutstanding(userId, request), {
    variant: "sign",
    shouldCache: (owed) => owed === null,
  });
}

/** Only "nothing owed" is cached: an owed form always re-checks, so submitting lets the user through at once. */
export function layoutFormGate(userId: string, request: Request) {
  return cachedForLayout(userId, "gates", () => getBoundFormGateOutstanding(userId, request), {
    variant: "form",
    shouldCache: (owed) => owed === null,
  });
}

// The live cycle ids are part of the key, so a cycle opening or closing is
// picked up on the next navigation without anything clearing the cache.
export function layoutIsLiveInterviewer(userId: string, liveCycleIds: string[]) {
  return cachedForLayout(
    userId,
    "hiring",
    async () =>
      (await prisma.cycleInterviewer.findFirst({
        where: { userId, applicationCycleId: { in: liveCycleIds } },
        select: { id: true },
      })) !== null,
    { variant: `interviewer:${cycleKey(liveCycleIds)}` },
  );
}

export function layoutIsAnyCycleReviewer(userId: string) {
  return cachedForLayout(
    userId,
    "hiring",
    async () =>
      (await prisma.cycleReviewer.findFirst({ where: { userId }, select: { id: true } })) !== null,
    { variant: "anyReviewer" },
  );
}

export function layoutHasLiveCycleRole(userId: string, liveCycleIds: string[]) {
  return cachedForLayout(
    userId,
    "hiring",
    async () => {
      const where = { userId, applicationCycleId: { in: liveCycleIds } };
      const [reviewer, interviewer] = await Promise.all([
        prisma.cycleReviewer.findFirst({ where, select: { id: true } }),
        prisma.cycleInterviewer.findFirst({ where, select: { id: true } }),
      ]);
      return reviewer !== null || interviewer !== null;
    },
    { variant: `live:${cycleKey(liveCycleIds)}` },
  );
}

export function layoutIsLabMentor(userId: string, request: Request) {
  return cachedForLayout(userId, "mentor", () => isLabMentor(userId, undefined, request));
}

export function layoutHasUnseenReleaseNotes(userId: string, isCore: boolean, request: Request) {
  return cachedForLayout(
    userId,
    "releaseNotes",
    async () =>
      viewerHasUnseenReleaseNotes({
        userId,
        isCore,
        groupIds: (await listVisibleGroupIdsForUser(userId, request)).map((g) => g.id),
      }),
    { variant: isCore ? "core" : "member" },
  );
}

export function layoutIsNewMember(userId: string) {
  return cachedForLayout(userId, "newMember", () => isNewMemberCohort(userId));
}
