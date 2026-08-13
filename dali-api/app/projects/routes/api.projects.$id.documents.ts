import type { Route } from "./+types/api.projects.$id.documents";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { createProjectPage, pageDepth, MAX_PAGE_DEPTH } from "~/lib/pages";

// POST /api/projects/:id/documents
//
// Add a project document or folder. Both are Pages scoped to the project
// workspace (workspaceType=Project, workspaceId=projectId) — the same Page
// model the project Overview/PRD use. Body: { title, kind?, parentPageId? }.
// kind defaults to "FreeForm" (a document); "Folder" creates a container
// page. parentPageId nests a document OR a folder under any existing Folder,
// up to depth MAX_PAGE_DEPTH.
//
// The rich-text body of a FreeForm page lives in the collab editor
// (contentDocId), which is a separate system; this route only creates the
// Page shell + title. Same permission model as project edit (isCore ===
// Admin || Core).

const BodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["FreeForm", "Folder"]).optional().default("FreeForm"),
  parentPageId: z.string().min(1).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireProjectEditAccess(request, params.id!);
  if (!gate.ok) return gate.response;
  const auth = gate.auth;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  if (body.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: body.parentPageId },
      select: { workspaceType: true, workspaceId: true, parentPageId: true, kind: true, archivedAt: true },
    });
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== "Project" ||
      parent.workspaceId !== params.id
    ) {
      return withCors(request, Response.json({ error: "Parent folder not found" }, { status: 404 }));
    }
    if (parent.kind !== "Folder") {
      return withCors(
        request,
        Response.json({ error: "Documents can only nest inside a folder" }, { status: 400 }),
      );
    }
    const depth = await pageDepth(body.parentPageId);
    if (depth < 0 || depth >= MAX_PAGE_DEPTH) {
      return withCors(request, Response.json({ error: "Folder is too deeply nested" }, { status: 400 }));
    }
  }

  const page = await createProjectPage({
    projectId: params.id!,
    title: body.title,
    createdById: auth.user.sub,
    kind: body.kind,
    parentPageId: body.parentPageId ?? null,
  });

  return withCors(request, Response.json({ id: page.id }));
}
