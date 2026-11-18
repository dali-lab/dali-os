import type { Route } from "./+types/api.paperwork.count";
import { guardPaperwork } from "../lib/guard.server";
import { loadPaperworkCount } from "../lib/paperwork.server";

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await guardPaperwork(request, { page: false });
  if (!guard.ok) return guard.response.status === 404 ? Response.json({ count: 0 }) : guard.response;
  return Response.json({ count: await loadPaperworkCount(guard.userId, guard.roles, request) });
}
