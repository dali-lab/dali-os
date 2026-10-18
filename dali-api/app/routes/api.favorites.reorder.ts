import type { Route } from "./+types/api.favorites.reorder";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { reorderFavorites } from "~/lib/user-pages.server";

// POST /api/favorites/reorder — persist a drag-reorder of the favorites bar.
// Body: { ids: string[] } of FavoritePage.id values (page id, or href for a
// route). Only the caller's own favorites are touched.

const MAX_REORDER_IDS = 500;

function isBody(x: unknown): x is { ids: string[] } {
  if (!x || typeof x !== "object") return false;
  const ids = (x as Record<string, unknown>).ids;
  return (
    Array.isArray(ids) &&
    ids.length <= MAX_REORDER_IDS &&
    ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 2000)
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  await reorderFavorites(gate.auth.user.sub, body.ids);
  return withCors(request, Response.json({ ok: true }));
}
