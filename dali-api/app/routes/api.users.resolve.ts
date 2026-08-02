import type { Route } from "./+types/api.users.resolve";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { resolvePhotoUrl } from "~/lib/photo";

// GET /api/users/resolve?ids=<comma-separated user ids>
//
// Returns { users: [{ id, name, photoUrl }] } for the given ids. Used by the
// comments rail and presence bar to resolve avatar + display name in bulk.
//
// Auth: any authenticated session (member or partner) that can reach documents.
// IDs not found in the database are silently omitted (no 404).
// Cap at 50 ids per request to bound the query size.

const MAX_IDS = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const url = new URL(request.url);
  const raw = url.searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return withCors(request, Response.json({ users: [] }));
  }

  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, photoUrl: true },
  });

  const users = await Promise.all(
    rows.map(async (u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.id,
      photoUrl: await resolvePhotoUrl(u.photoUrl),
    })),
  );

  return withCors(request, Response.json({ users }));
}
