import type { Route } from "./+types/api.cycles.$cycleId.delibs.events";
import { requireAuth, forbidden } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { busEventStream } from "~/lib/sse.server";
import { delibsTopic } from "~/hiring/lib/delibs-events.server";

// GET /api/hiring/cycles/:cycleId/delibs/events
//
// SSE for the cycle's delibs boards (lead kanban and reviewer mirror). Carries
// no board data, only `change` / `sync` cues to revalidate.

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (!(await hasCycleAccess(auth.user.sub, params.cycleId))) return forbidden(request);
  // Qualification also reads review state that a few rarer writes (auto-assign,
  // admin edits) don't publish, so re-sync each minute rather than every five.
  return busEventStream(request, [delibsTopic(params.cycleId)], { syncMs: 60_000 });
}
