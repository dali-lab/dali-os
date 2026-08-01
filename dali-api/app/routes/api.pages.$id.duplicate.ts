import type { Route } from "./+types/api.pages.$id.duplicate";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { duplicatePage } from "~/lib/page-copy.server";

// POST /api/pages/:id/duplicate
//
// Copies the Page row (title + " (copy)") and byte-copies the CollabDocument
// state to the new page's room. The new page inherits the source's workspace
// and parent. Returns { id: string } — the caller redirects to /documents/:id.
//
// Permission: the viewer must have canEdit access to the source page's
// workspace (checked inside duplicatePage via getPageAccess).

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return withCors(request, Response.json({ error: "Unauthorized" }, { status: 401 }));
  }

  try {
    const result = await duplicatePage({
      sourcePageId: params.id!,
      createdById: auth.user.sub,
    });
    return withCors(request, Response.json({ id: result.id }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    const status = message === "Permission denied" ? 403 : message === "Page not found" ? 404 : 500;
    return withCors(request, Response.json({ error: message }, { status }));
  }
}
