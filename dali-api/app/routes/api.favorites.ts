import type { Route } from "./+types/api.favorites";
import { requireMemberSession } from "~/lib/auth";
import { withCors } from "~/lib/cors";
import { listFavoritesAndRecents } from "~/lib/user-pages.server";

// GET /api/favorites — the caller's starred pages, as the shell header draws
// them. The header normally reads this off the layout loader, but that loader
// is deliberately not revalidated on fetcher writes (see routes/layout.tsx), so
// a star landing mid-session re-reads the one list from here rather than paying
// for the whole shell again.
export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const { favorites } = await listFavoritesAndRecents(gate.auth.user.sub, request);
  return withCors(request, Response.json({ favorites }));
}
