import type { Route } from "./+types/api.public.projects";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { listPublicProjects } from "../lib/public-projects.server";

// GET /api/public/projects — every Published ProjectShowcase row, in the
// shape dali.website's projects page consumes. Machine-to-machine only: the
// site's Express server calls this and re-serves the result, so the shared
// secret never reaches a browser.

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const projects = await listPublicProjects();
  return Response.json({ projects, total: projects.length });
}
