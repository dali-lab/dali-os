// Activity surface (specs/activities.md §7.7). Generic route: it loads the
// activity + the member's events, computes progress/results via the SERVER
// mechanic registry, and delegates rendering to the CLIENT mechanic's Surface.
// The action forwards form fields to the mechanic's onAction. Server-only
// imports (prisma, *.server) are stripped from the client bundle by React
// Router; the component uses only the client registry.

import { useLoaderData } from "react-router";
import type { Route } from "./+types/activities.$id";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { ACTIVITIES_FLAG } from "~/lib/activities";
import { getActivityForMember } from "~/lib/activities.server";
import { mechanicServer } from "~/activities/mechanics/registry.server";
import { mechanicClient } from "~/activities/mechanics/registry";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.name ?? "Activity"} · DALI OS` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId);
  if (!(await isFeatureEnabled(ACTIVITIES_FLAG, userId, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }

  const found = await getActivityForMember(params.id, userId, roles);
  if (!found || !found.assigned) throw new Response("Not found", { status: 404 });
  const { activity, active } = found;

  const mech = mechanicServer(activity.kind);
  if (!mech) throw new Response("Not found", { status: 404 });

  const [userEvents, allEvents, viewerIsCore] = await Promise.all([
    prisma.activityEvent.findMany({ where: { activityId: activity.id, userId } }),
    prisma.activityEvent.findMany({ where: { activityId: activity.id } }),
    isCore(userId),
  ]);

  const { progress, results } = mech.summarize({
    activity,
    userId,
    viewerIsCore,
    userEvents,
    allEvents,
  });

  // Resolve display names for anyone on the leaderboard.
  const ids = [...new Set(allEvents.map((e) => e.userId))];
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
  if (!(await isFeatureEnabled(ACTIVITIES_FLAG, userId, roles, request))) {
    return Response.json({ ok: false, message: "Not available." }, { status: 404 });
  }

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
  return Response.json(outcome, { status: outcome.ok ? 200 : 400 });
}

export default function ActivitySurface() {
  const data = useLoaderData<typeof loader>();
  const mech = mechanicClient(data.kind);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-foreground">{data.name}</h1>
        {!data.active && (
          <p className="mt-1 text-sm text-muted-foreground">
            This activity isn’t live right now.
          </p>
        )}
      </header>
      {mech ? (
        <mech.Surface
          activityId={data.activityId}
          name={data.name}
          currentUserId={data.currentUserId}
          nameByUserId={data.nameByUserId}
          progress={data.progress}
          results={data.results}
        />
      ) : (
        <p className="text-sm text-muted-foreground">This activity type isn’t supported here.</p>
      )}
    </div>
  );
}
