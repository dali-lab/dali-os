import type { Route } from "./+types/api.lab-documents";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { createLabPage, pageDepth, MAX_PAGE_DEPTH } from "~/lib/pages";

// POST /api/lab-documents
//
// Add a lab-wide document or folder — Pages scoped to the Lab workspace
// (workspaceType=Lab, workspaceId=null), the same Page model the project
// Documents block uses, just lab-scoped. Body: { title, kind?, parentPageId? }.
// kind defaults to "FreeForm"; "Folder" creates a container. parentPageId nests
// a document OR a folder under an existing Folder, up to MAX_PAGE_DEPTH levels
// deep. Any lab member may create — the lab's members are the Lab workspace's
// members (mirrors the project-member gate on project docs).

const BodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["FreeForm", "Folder"]).optional().default("FreeForm"),
  parentPageId: z.string().min(1).optional(),
});

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const auth = gate.auth;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  if (body.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: body.parentPageId },
      select: { workspaceType: true, workspaceId: true, kind: true, archivedAt: true },
    });
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== "Lab" ||
      parent.workspaceId !== null
    ) {
      return withCors(request, Response.json({ error: "Parent folder not found" }, { status: 404 }));
    }
    if (parent.kind !== "Folder") {
      return withCors(
        request,
        Response.json({ error: "Pages can only nest inside a folder" }, { status: 400 }),
      );
    }
    const depth = await pageDepth(body.parentPageId);
    if (depth < 0 || depth >= MAX_PAGE_DEPTH) {
      return withCors(request, Response.json({ error: "Folder is too deeply nested" }, { status: 400 }));
    }
  }

  const page = await createLabPage({
    title: body.title,
    createdById: auth.user.sub,
    kind: body.kind,
    parentPageId: body.parentPageId ?? null,
  });

  return withCors(request, Response.json({ id: page.id }));
}
