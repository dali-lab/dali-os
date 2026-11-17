import type { Route } from "./+types/api.resource-hub.$pageId.crit";
import { loadCritContext, loadCritPage, loadCritPostsByIds } from "~/lib/crit.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await loadCritContext(request, params.pageId);
  const search = new URL(request.url).searchParams;
  const ids = search.get("ids");
  if (ids !== null) return Response.json({ items: await loadCritPostsByIds(ctx, ids.split(",").filter(Boolean)), nextCursor: null });
  return Response.json(await loadCritPage(ctx, search.get("cursor")));
}
