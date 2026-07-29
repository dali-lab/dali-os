import type { Route } from "./+types/partner.calendar.$token";
import { buildPartnerFeedIcs } from "~/partners/lib/partner-calendar.server";

// GET /partner/calendar/:token — a partner's personal ICS subscribe feed of
// all their shared meetings. Public: the secret token IS the credential (same
// pattern as any calendar-subscription URL). Any calendar app can add it.
export async function loader({ params }: Route.LoaderArgs) {
  const ics = await buildPartnerFeedIcs(params.token);
  if (ics === null) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="dali-partner.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
