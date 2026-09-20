import type { Route } from "./+types/api.public.application-cycle";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { getPublicApplicationCycleResponse } from "../lib/public-application-cycle.server";

// GET /api/public/application-cycle — the public (Students) hiring cycles
// currently accepting applications, and by when. Drives the application-cycle
// cards on dali.website's Apply page. Several cycles can be open at once:
// `cycles` lists them all; `cycle` is the soonest-closing one (or the closed
// shape), kept for one release while the site moves to `cycles`.

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  return Response.json(await getPublicApplicationCycleResponse());
}
