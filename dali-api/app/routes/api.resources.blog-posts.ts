import type { Route } from "./+types/api.resources.blog-posts";
import { requireResourcesViewer } from "~/lib/resources.server";
import { loadBlogFeedPage } from "~/lib/blog-post.server";

// GET /api/resources/blog-posts?cursor= — the next published, unpinned posts for
// the Resources front page. Same gate as that page (community flag, lab members).
export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireResourcesViewer(request);
  const cursor = new URL(request.url).searchParams.get("cursor");
  return Response.json(await loadBlogFeedPage(user.sub, cursor));
}
