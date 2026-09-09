// Activities index (specs/activities.md §7.7): the activities live for this
// member right now, each linking to its surface. Usually one; empty when
// nothing is live or the flag is off.

import { Link, useLoaderData } from "react-router";
import { Sparkles } from "lucide-react";
import type { Route } from "./+types/activities._index";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { ACTIVITIES_FLAG, activityKindLabel } from "~/lib/activities";
import { resolveActiveActivitiesForUser } from "~/lib/activities.server";

export const meta: Route.MetaFunction = () => [{ title: "Activities · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId);
  if (!(await isFeatureEnabled(ACTIVITIES_FLAG, userId, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }
  const activities = await resolveActiveActivitiesForUser(userId, roles, new Date(), "");
  return {
    activities: activities.map((a) => ({ id: a.id, kind: a.kind, name: a.name, endsAt: a.endsAt })),
  };
}

export default function ActivitiesIndex() {
  const { activities } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Activities</h1>
      {activities.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing is running right now. Check back when an activity is live.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {activities.map((a) => (
            <li key={a.id}>
              <Link
                to={`/activities/${a.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-coral/10">
                  <Sparkles className="h-4 w-4 text-accent-coral" />
                </span>
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{a.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {activityKindLabel(a.kind)} · ends {new Date(a.endsAt).toLocaleDateString()}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
