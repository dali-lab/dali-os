import type { Route } from "./+types/api.public.projects.$id";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { getPublicProject } from "../lib/public-projects.server";

// GET /api/public/projects/:id — one published project plus the block content
// of its public write-up (the project page flagged publicVisible). 404s for a
// project that exists but isn't published, so an unpublished id is
// indistinguishable from a missing one.

export async function loader({ request, params }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const result = await getPublicProject(params.id!);
  if (!result) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  return Response.json(result);
}
