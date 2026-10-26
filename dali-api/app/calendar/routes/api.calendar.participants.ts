import type { Route } from "./+types/api.calendar.participants";
import { requireAuth, forbidden } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { loadParticipantOptions } from "~/calendar/routes/calendar.server";

// GET /api/calendar/participants: the lab directory for the calendar's
// participant pickers. Kept out of the calendar loader, which reruns on every
// week change and save; the page fetches this once in the background.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isLabMember(auth.user.sub, request))) return forbidden(request);
  return Response.json(await loadParticipantOptions(request, auth.user.sub));
}
