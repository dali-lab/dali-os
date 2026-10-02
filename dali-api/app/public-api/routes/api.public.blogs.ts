import type { Route } from "./+types/api.public.blogs";
import { requireShowcaseSecret } from "../lib/public-auth.server";
import { listPublicBlogs } from "../lib/public-blogs.server";

// GET /api/public/blogs — blog posts published with Public visibility, newest
// first. Internal posts and drafts never appear here.

export async function loader({ request }: Route.LoaderArgs) {
  const denied = requireShowcaseSecret(request);
  if (denied) return denied;

  const blogs = await listPublicBlogs();
  return Response.json({ blogs, total: blogs.length });
}
