import type { Route } from "./+types/api.pages.$id.favorite";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { getPageAccess } from "~/lib/pageAccess.server";
import { setFavorite } from "~/lib/user-pages.server";

// POST /api/pages/:id/favorite — add or remove this page from the caller's own
// Favorites. Body: { favorited: boolean }.
//
// Distinct from /api/pages/:id/pin, which sets Page.pinnedAt — one shared pin
// on a project's Documents block that everyone sees. This one is personal and
// affects nobody else's home page.
//
// Gated on canView, not canEdit: bookmarking something you're allowed to read
// is not a change to the document.

type Body = { favorited: boolean };

function isBody(x: unknown): x is Body {
  return (
    !!x && typeof x === "object" && typeof (x as Record<string, unknown>).favorited === "boolean"
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const userId = gate.auth.user.sub;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const pageId = params.id!;
  // Same 404 whether the page is missing or merely unreadable — favouriting
  // must not become a way to probe which page ids exist.
  const access = await getPageAccess(userId, pageId);
  if (!access.canView) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }

  await setFavorite(userId, pageId, body.favorited);
  return withCors(request, Response.json({ ok: true, favorited: body.favorited }));
}
