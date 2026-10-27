import type { Route } from "./+types/api.activities.$id.stream";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { getActivityForMember } from "~/lib/activities.server";
import { activityTopic } from "~/lib/activity-events.server";
import { busEventStream } from "~/lib/sse.server";

// SSE for one activity's surface (specs/activities.md §7.6): a code submit or
// hint reveal by anyone pushes `change`, so every open leaderboard stays live.
// Gated on assignment, like the data endpoint it complements.

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId);
  const found = await getActivityForMember(params.id, userId, roles);
  if (!found || !found.assigned) return new Response("Not found", { status: 404 });

  return busEventStream(request, [activityTopic(params.id)]);
}
