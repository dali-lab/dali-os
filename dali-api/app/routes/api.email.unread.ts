import type { Route } from "./+types/api.email.unread";
import { requireAuth } from "~/lib/auth";
import { loadUnreadTotal } from "~/email/lib/email.server";

// GET /api/email/unread → { total }: unread inbox messages across every inbox
// the user can read. Polled by the sidebar's Email badge.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  return Response.json({ total: await loadUnreadTotal(request, userId) });
}
