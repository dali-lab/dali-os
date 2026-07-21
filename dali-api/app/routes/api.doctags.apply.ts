import type { Route } from "./+types/api.doctags.apply";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

// Apply or remove a lab tag on a document (Page) or file (ProjectFile).
//   POST /api/doctags/apply
//   { targetType: "doc" | "file", targetId, tagId, op: "add" | "remove" }
//
// Applying an existing tag mirrors the project-edit gate (isCore === Admin ||
// Core) — the same surface that can edit the doc/file can label it. (Creating
// *new* tags is the separate Core-only /api/doctags POST.)

const ApplySchema = z.object({
  targetType: z.enum(["doc", "file"]),
  targetId: z.string().min(1),
  tagId: z.string().min(1),
  op: z.enum(["add", "remove"]),
});

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  const body = await parseJson(request, ApplySchema);
  if (body instanceof Response) return withCors(request, body);
  const { targetType, targetId, tagId, op } = body;

  const tag = await prisma.docTag.findUnique({ where: { id: tagId }, select: { id: true } });
  if (!tag) return withCors(request, Response.json({ error: "Tag not found" }, { status: 404 }));

  if (targetType === "doc") {
    const page = await prisma.page.findUnique({
      where: { id: targetId },
      select: { workspaceType: true, archivedAt: true },
    });
    if (
      !page ||
      (page.workspaceType !== "Project" && page.workspaceType !== "Lab") ||
      page.archivedAt !== null
    ) {
      return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
    }
    if (op === "add") {
      await prisma.pageTag.upsert({
        where: { pageId_tagId: { pageId: targetId, tagId } },
        create: { pageId: targetId, tagId },
        update: {},
      });
    } else {
      await prisma.pageTag.deleteMany({ where: { pageId: targetId, tagId } });
    }
    return withCors(request, Response.json({ ok: true }));
  }

  // targetType === "file"
  const file = await prisma.projectFile.findUnique({
    where: { id: targetId },
    select: { archivedAt: true },
  });
  if (!file || file.archivedAt !== null) {
    return withCors(request, Response.json({ error: "File not found" }, { status: 404 }));
  }
  if (op === "add") {
    await prisma.projectFileTag.upsert({
      where: { fileId_tagId: { fileId: targetId, tagId } },
      create: { fileId: targetId, tagId },
      update: {},
    });
  } else {
    await prisma.projectFileTag.deleteMany({ where: { fileId: targetId, tagId } });
  }
  return withCors(request, Response.json({ ok: true }));
}
