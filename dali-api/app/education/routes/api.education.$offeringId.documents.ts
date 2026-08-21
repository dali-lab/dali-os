import type { Route } from "./+types/api.education.$offeringId.documents";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireOfferingManager } from "~/education/lib/access.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { createMaterialPage } from "~/education/lib/lms.server";
import { pageDepth, MAX_PAGE_DEPTH } from "~/lib/pages";

// POST /api/education/:offeringId/documents
//
// Add a document or folder to an education offering's Drive workspace.
// Mirrors /api/projects/:id/documents: same body shape, same response
// ({ id }). Only instructors for this offering and Core may create here.
//
// Auth: isOfferingManager (Core OR InstructorAssignment for this offering).
// Parent validation: must live in the EducationOffering workspace, be a
// non-archived Folder, and be at depth < MAX_PAGE_DEPTH.

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

  const gate = await requireOfferingManager(request, params.offeringId!);
  if (!gate.ok) return withCors(request, gate.response);
  const auth = gate.auth;

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.offeringId },
    select: { id: true },
  });
  if (!offering) {
    return withCors(request, Response.json({ error: "Offering not found" }, { status: 404 }));
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  // Validate parent folder when provided: must be in this offering's workspace,
  // not archived, a Folder, and not already at MAX_PAGE_DEPTH.
  if (body.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: body.parentPageId },
      select: { workspaceType: true, workspaceId: true, kind: true, archivedAt: true },
    });
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== "EducationOffering" ||
      parent.workspaceId !== params.offeringId
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

  const result = await createMaterialPage({
    offeringId: params.offeringId!,
    title: body.title,
    kind: body.kind,
    parentPageId: body.parentPageId ?? null,
    actorId: auth.user.sub,
  });

  if ("error" in result) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }

  return withCors(request, Response.json({ id: result.id }));
}
