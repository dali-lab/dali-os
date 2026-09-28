// Activity data endpoint (specs/activities.md §7.7). A resource route — no UI —
// that the shell's ActivityLauncher modal fetches from: the loader returns the
// member's progress + results (computed via the SERVER mechanic registry), and
// the action forwards a submitted form to the mechanic's onAction. The surface
// itself renders in a modal over whatever page the member is on (the activity's
// whole point is to explore the site), so there is no navigable page here — just
// this endpoint the modal loads and posts to. Gated on assignment.

import type { Route } from "./+types/api.activities.$id";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { getActivityForMember, listActivityTeams } from "~/lib/activities.server";
import { mechanicServer } from "~/activities/mechanics/registry.server";
import { publishActivityChange } from "~/lib/activity-events.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ ok: false }, { status: 401 });
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId);
  const found = await getActivityForMember(params.id, userId, roles);
  if (!found || !found.assigned) throw new Response("Not found", { status: 404 });
  const { activity, active, team } = found;

  const mech = mechanicServer(activity.kind);
  if (!mech) throw new Response("Not found", { status: 404 });

  const [userEvents, allEvents, viewerIsCore, teams] = await Promise.all([
    prisma.activityEvent.findMany({ where: { activityId: activity.id, userId } }),
    prisma.activityEvent.findMany({ where: { activityId: activity.id } }),
    isCore(userId),
    activity.scoring === "Team" ? listActivityTeams(activity.id) : [],
  ]);

  const { progress, results } = mech.summarize({
    activity,
    userId,
    viewerIsCore,
    userEvents,
    allEvents,
    teams,
    viewerTeam: team,
  });

  // Resolve display names for anyone on the leaderboard — plus every teammate,
  // who is named on a team's row (and beside a clue they found) whether or not
  // they've scored yet.
  const ids = [
    ...new Set([...allEvents.map((e) => e.userId), ...teams.flatMap((t) => t.memberIds)]),
  ];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameByUserId = Object.fromEntries(users.map((u) => [u.id, fullName(u)]));

  return {
    activityId: activity.id,
    name: activity.name,
    kind: activity.kind,
    active,
    currentUserId: userId,
    nameByUserId,
    progress,
    results,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId);
  const found = await getActivityForMember(params.id, userId, roles);
  if (!found || !found.assigned) {
    return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  }
  if (!found.active) {
    return Response.json({ ok: false, message: "This activity has ended." }, { status: 400 });
  }
  const mech = mechanicServer(found.activity.kind);
  if (!mech) return Response.json({ ok: false, message: "Unsupported." }, { status: 400 });

  const form = await request.formData();
  const input = Object.fromEntries(form) as Record<string, unknown>;
  const outcome = await mech.onAction({ activity: found.activity, userId, input });
  // Nudge every open surface for this activity so the leaderboard updates live.
  if (outcome.ok) publishActivityChange(params.id);
  return Response.json(outcome, { status: outcome.ok ? 200 : 400 });
}
