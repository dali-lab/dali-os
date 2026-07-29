import type { Route } from "./+types/partner.meetings.$id.ics";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { buildSingleMeetingIcs } from "~/partners/lib/partner-calendar.server";

// GET /partner/meetings/:id/ics — download one shared meeting as a calendar
// invite. Access-checked for the signed-in partner.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth } = await requirePartner(request);
  const ics = await buildSingleMeetingIcs(params.id, auth.user.sub);
  if (!ics) throw new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meeting.ics"',
    },
  });
}
