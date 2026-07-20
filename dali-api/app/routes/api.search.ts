import type { Route } from "./+types/api.search";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { runSearch } from "~/lib/search.server";

// Global command-palette search.
//   GET /api/search?q=...  → { results: SearchResult[] }
// Results are permission-scoped server-side (see lib/search.server.ts). Empty
// for a <2-char query or a non-member session.
export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const roles = await getUserRoles(auth.user.sub);
  const results = await runSearch({ userId: auth.user.sub, roles, q });

  return withCors(request, Response.json({ results }));
}
