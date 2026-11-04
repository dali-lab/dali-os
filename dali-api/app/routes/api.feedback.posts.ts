import type { Route } from "./+types/api.feedback.posts";
import { requireFeedbackViewer } from "~/lib/feedback.server";
import { loadFeedbackPage, loadFeedbackPostsByIds } from "~/lib/feedback-feed.server";

// `ids` re-reads specific posts so a feed holding later pages can refresh them
// after a vote, comment or delete; `cursor` loads the next page.
export async function loader({ request }: Route.LoaderArgs) {
  const { user, core } = await requireFeedbackViewer(request);
  const viewer = { userId: user.sub, core };
  const params = new URL(request.url).searchParams;
  const ids = params.get("ids");
  if (ids !== null) {
    const posts = await loadFeedbackPostsByIds(ids.split(",").filter(Boolean), viewer);
    return Response.json({ items: posts, nextCursor: null });
  }
  return Response.json(await loadFeedbackPage(params.get("cursor"), viewer));
}
