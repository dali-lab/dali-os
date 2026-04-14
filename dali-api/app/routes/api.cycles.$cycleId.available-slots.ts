import type { Route } from "./+types/api.cycles.$cycleId.available-slots";
import { withCors, handlePreflight } from "~/lib/cors";
import { computeAvailableSlots } from "~/lib/scheduling";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const domainIds = url.searchParams.getAll("domainId");

  if (domainIds.length === 0) {
    return withCors(request, Response.json({ error: "At least one domainId query param required" }, { status: 400 }));
  }

  const slots = await computeAvailableSlots(params.cycleId, domainIds);

  return withCors(request, Response.json(slots));
}
