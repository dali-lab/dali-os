import type { Route } from "./+types/api.public.blogs.$id";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { getPublicBlog } from "../lib/public-blogs.server";

// GET /api/public/blogs/:id — one public blog post with its body as HTML.
// 404s for an internal post or a draft, so neither is distinguishable from a
// missing id.

export async function loader({ request, params }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const result = await getPublicBlog(params.id!);
  if (!result) {
    return Response.json({ error: "Blog not found" }, { status: 404 });
  }
  return Response.json(result);
}
