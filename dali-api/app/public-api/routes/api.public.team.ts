import type { Route } from "./+types/api.public.team";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { listPublicTeam } from "../lib/public-team.server";

// GET /api/public/team — members who opted into the public directory, with a
// hard-coded narrow field set. See public-team.server.ts for what may and may
// not be returned here.

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const members = await listPublicTeam();
  return Response.json({ members, total: members.length });
}
