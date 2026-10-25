import type { Route } from "./+types/api.admin.attention";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loadAdminAttention } from "~/admin/lib/attention.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isCore(auth.user.sub))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { counts } = await loadAdminAttention();
  return { counts };
}
