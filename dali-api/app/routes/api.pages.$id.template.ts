import type { Route } from "./+types/api.pages.$id.template";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { getPageAccess } from "~/lib/pageAccess.server";

// POST /api/pages/:id/template
//
// Toggle isTemplate on a FreeForm Page. Body: { isTemplate: boolean }.
// Requires canEdit access to the page. Templates are excluded from normal
// document lists and offered as a starting point for new pages (see
// /api/page-templates for the list endpoint).

const BodySchema = z.object({
  isTemplate: z.boolean(),
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
      Response.json({ error: "Only FreeForm pages can be templates" }, { status: 400 }),
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
    data: { isTemplate: body.isTemplate },
  });

  return withCors(request, Response.json({ ok: true }));
}
