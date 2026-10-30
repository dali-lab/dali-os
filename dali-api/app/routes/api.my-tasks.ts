import type { Route } from "./+types/api.my-tasks";
import { requireAuth } from "~/lib/auth";
import { listMyProjectTasksPage, listOpenTasksPage } from "~/lib/tasks";

// Further pages of the My Tasks lists. `kind=open` is the notification-backed
// list (keyset cursor); `kind=project` is assigned project work (offset cursor).
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor");
  const userId = auth.user.sub;

  if (params.get("kind") === "project") {
    return Response.json(await listMyProjectTasksPage(userId, { cursor }));
  }
  if (params.get("kind") === "open") {
    return Response.json(await listOpenTasksPage(userId, { cursor, request }));
  }
  return Response.json({ error: "Unknown kind" }, { status: 400 });
}
