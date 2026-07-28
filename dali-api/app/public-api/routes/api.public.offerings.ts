import type { Route } from "./+types/api.public.offerings";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { listPublicOfferings } from "../lib/public-offerings.server";

// GET /api/public/offerings — Published education offerings for the site's
// offerings calendar.

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const offerings = await listPublicOfferings();
  return Response.json({ offerings, total: offerings.length });
}
