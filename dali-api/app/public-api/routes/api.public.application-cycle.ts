import type { Route } from "./+types/api.public.application-cycle";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { getPublicApplicationCycle } from "../lib/public-application-cycle.server";

// GET /api/public/application-cycle — whether the public (Standard) hiring
// cycle is currently accepting applications, and by when. Drives the
// application-cycle card on dali.website's Apply page. No query params: there
// is at most one active Standard cycle at a time.

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  return Response.json({ cycle: await getPublicApplicationCycle() });
}
