import type { Route } from "./+types/api.resource-hub.$pageId.references";
import { loadReferencesByIds, loadReferencesContext, loadReferencesPage } from "~/lib/references.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await loadReferencesContext(request, params.pageId);
  const search = new URL(request.url).searchParams;
  const ids = search.get("ids");
  if (ids !== null) return Response.json({ items: await loadReferencesByIds(ctx, ids.split(",").filter(Boolean)), nextCursor: null });
  return Response.json(await loadReferencesPage(ctx, search.get("cursor")));
}
