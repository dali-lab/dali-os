import type { Route } from "./+types/connect.events.$id.calendar";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getEventForCalendar } from "~/members/lib/community-events.server";
import { buildEventIcs } from "~/members/lib/event-ics";

const fileName = (title: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event"}.ics`;

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const result = await getEventForCalendar(auth.user.sub, params.id);
  if (!result.ok) return new Response(result.error, { status: result.status });
  const { event } = result;
  const location = event.online ? null : [event.placeName, event.address].filter(Boolean).join(", ");
  const ics = buildEventIcs({
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    description: event.description,
    location,
    url: event.online ? event.meetingUrl : null,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName(event.title)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
