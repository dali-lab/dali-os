import type { Route } from "./+types/api.upcoming-meetings";
import { requireAuth } from "~/lib/auth";
import { loadUpcomingMeetings } from "~/lib/upcoming-meetings.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  return Response.json({ meetings: await loadUpcomingMeetings(auth.user.sub, request) });
}
