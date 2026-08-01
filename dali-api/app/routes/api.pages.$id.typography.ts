import type { Route } from "./+types/api.pages.$id.typography";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { getPageAccess } from "~/lib/pageAccess.server";

// POST /api/pages/:id/typography
//
// Set the per-page display prefs (Notion's Style section) on a FreeForm Page.
// Body: { font: "default" | "serif" | "mono", smallText: boolean,
// fullWidth: boolean }. Requires canEdit access; the prefs are shared — every
// viewer sees the same rendering.

const BodySchema = z.object({
  font: z.enum(["default", "serif", "mono"]),
  smallText: z.boolean(),
  fullWidth: z.boolean(),
  // default(false): tolerate clients bundled before this field existed.
  nestingGuides: z.boolean().default(false),
});

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

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const page = await prisma.page.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      kind: true,
    },
  });
  if (!page || page.archivedAt !== null) {
    return withCors(request, Response.json({ error: "Page not found" }, { status: 404 }));
  }
  if (page.kind !== "FreeForm") {
    return withCors(
      request,
      Response.json({ error: "Only FreeForm pages have typography settings" }, { status: 400 }),
    );
  }

  const access = await getPageAccess(auth.user.sub, {
    id: page.id,
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    archivedAt: page.archivedAt,
  });
  if (!access.canEdit) {
    return withCors(request, Response.json({ error: "Permission denied" }, { status: 403 }));
  }

  await prisma.page.update({
    where: { id: params.id },
    data: { typography: body },
  });

  return withCors(request, Response.json({ ok: true }));
}
