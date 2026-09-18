import type { Route } from "./+types/api.page-templates.$id.blocks";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors } from "~/lib/cors";
import { getPageAccess } from "~/lib/pageAccess.server";
import { readDocAsBlocks } from "~/collab/read";
import { pageDocName } from "~/collab/roomName";

// GET /api/page-templates/:id/blocks
//
// A template's body as BlockNote blocks, for the document editor's ⋯ "Import
// template" action to insert into the open doc client-side. Only pages flagged
// isTemplate are served, and only to viewers who can read them.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return withCors(request, Response.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const page = await prisma.page.findUnique({
    where: { id: params.id },
    select: { id: true, archivedAt: true, isTemplate: true, kind: true },
  });
  if (!page || page.archivedAt !== null || !page.isTemplate || page.kind !== "FreeForm") {
    return withCors(request, Response.json({ error: "Template not found" }, { status: 404 }));
  }

  const access = await getPageAccess(auth.user.sub, page.id, request);
  if (!access.canView) {
    return withCors(request, Response.json({ error: "Permission denied" }, { status: 403 }));
  }

  const blocks = await readDocAsBlocks(pageDocName(page.id));
  return withCors(request, Response.json({ blocks }));
}
