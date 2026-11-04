import type { Route } from "./+types/api.announcements.sent";
import { loadSentAnnouncements } from "~/core/lib/announcements-sent.server";
import { requireAuth } from "~/lib/auth";
import { listVisibleGroupsForUser } from "~/lib/groups";
import { isCore } from "~/lib/roles";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isCore(auth.user.sub))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const groups = await listVisibleGroupsForUser(auth.user.sub);
  const cursor = new URL(request.url).searchParams.get("cursor");
  return Response.json(await loadSentAnnouncements(cursor, new Map(groups.map((g) => [g.id, g]))));
}
