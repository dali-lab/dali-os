import type { Route } from "./+types/api.staffing.events";
import { requireAuth, forbidden } from "~/lib/auth";
import { canViewStaffing } from "~/lib/roles";
import { busEventStream } from "~/lib/sse.server";
import { staffingTopic } from "../lib/staffing-events.server";

// GET /api/staffing/events?cycleId=<id>
//
// SSE for the staffing board: any assign / finalize / board-member mutation on
// this cycle pushes `change`, and the board revalidates on `change` or `sync`.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  // EventSource can't read a redirect body; signal auth failure with a status
  // the client's onerror handles by backing off.
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (!(await canViewStaffing(auth.user.sub))) {
    return forbidden(request);
  }

  const cycleId = new URL(request.url).searchParams.get("cycleId");
  if (!cycleId) return new Response("cycleId required", { status: 400 });

  // The board also reads preference and eligibility state no staffing write
  // publishes, so it keeps its short re-sync.
  return busEventStream(request, [staffingTopic(cycleId)], { syncMs: 25_000 });
}
