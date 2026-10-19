import type { Route } from "./+types/api.scheduling-data";
import { requireAuth, forbidden } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { loadSchedulingData } from "~/calendar/lib/scheduling-data.server";

// GET /api/scheduling-data
//
// The subset of the calendar loader CreateEventModal needs to mount in
// `mode="meeting-only"` outside /calendar — today, the partner CRM's
// ScheduleInterviewModal. Members only: a non-member (partner, applicant) has
// no working hours / calendar links / directory to schedule against.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isLabMember(auth.user.sub, request))) return forbidden(request);

  const result = await loadSchedulingData(request);
  if (!result.ok) return result.response;
  return Response.json(result.data);
}
