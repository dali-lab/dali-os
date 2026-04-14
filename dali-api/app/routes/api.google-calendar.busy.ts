import type { Route } from "./+types/api.google-calendar.busy";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { fetchBusyEvents } from "~/lib/google-calendar";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  if (!start || !end) {
    return withCors(request, Response.json({ error: "start and end query params required" }, { status: 400 }));
  }

  try {
    const busy = await fetchBusyEvents(auth.user.sub, new Date(start), new Date(end));
    return withCors(request, Response.json(busy));
  } catch (err: any) {
    return withCors(request, Response.json({ error: err.message }, { status: 500 }));
  }
}
