import type { Route } from "./+types/api.public.offerings";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import {
  listPublicOfferings,
  parseOfferingsFilter,
} from "../lib/public-offerings.server";

// GET /api/public/offerings — Published education offerings for the site's
// offerings section and calendar. Query params:
//   ?scope=upcoming|past|all   which slice (default upcoming)
//   ?from=<ISO>&to=<ISO>       calendar window (overlap); overrides scope
//   ?term=26F                  limit to one term (defaults scope to "all")

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const parsed = parseOfferingsFilter(new URL(request.url).searchParams);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const offerings = await listPublicOfferings(parsed.filter);
  return Response.json({ offerings, total: offerings.length });
}
