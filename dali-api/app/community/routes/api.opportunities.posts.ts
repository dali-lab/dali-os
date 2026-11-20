import type { Route } from "./+types/api.opportunities.posts";
import { requireOpportunityViewer } from "~/community/lib/opportunities-viewer.server";
import {
  loadOpportunityPage,
  loadOpportunityPostsByIds,
  loadViewerMatchProfile,
  parseShow,
} from "~/community/lib/opportunities-feed.server";

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireOpportunityViewer(request);
  const profile = await loadViewerMatchProfile(viewer.userId);
  const params = new URL(request.url).searchParams;
  const ids = params.get("ids");
  if (ids !== null) {
    const posts = await loadOpportunityPostsByIds(ids.split(",").filter(Boolean), viewer, profile);
    return Response.json({ items: posts, nextCursor: null });
  }
  const { items, nextCursor } = await loadOpportunityPage(params.get("cursor"), viewer, {
    show: parseShow(params.get("show")),
    profile,
  });
  return Response.json({ items, nextCursor });
}
