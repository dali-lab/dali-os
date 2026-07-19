import type { Route } from "./+types/api.documents.$id";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

// POST   /api/documents/:id — rename. Body: { title }
// DELETE /api/documents/:id — soft delete (sets archivedAt, matching the
//                             Page model's documented soft-delete pattern;
//                             archived pages drop out of the project list).
//
// Documents are project-scoped FreeForm Pages. Same permission model as
// project edit (isCore === Admin || Core).

type Body = { title: string };

function isBody(x: unknown): x is Body {
  return !!x && typeof x === "object" && typeof (x as Record<string, unknown>).title === "string";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const pageId = params.id!;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, workspaceType: true, workspaceId: true, systemKey: true, kind: true },
  });
  if (!page || page.workspaceType !== "Project" || !page.workspaceId) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, page.workspaceId);
  if (!gate.ok) return gate.response;
  const auth = gate.auth;

  if (request.method === "DELETE") {
    if (page.systemKey) {
      return withCors(
        request,
        Response.json({ error: "This default folder can't be deleted" }, { status: 400 }),
      );
    }
    if (page.kind === "Folder") {
      const childCount = await prisma.page.count({
        where: { parentPageId: pageId, archivedAt: null },
      });
      if (childCount > 0) {
        return withCors(
          request,
          Response.json({ error: "Move or delete the documents inside this folder first" }, { status: 400 }),
        );
      }
    }
    await prisma.page.update({
      where: { id: pageId },
      data: { archivedAt: new Date() },
    });
    await logAuditEvent({
      action: "document.delete",
      userId: auth.user.sub,
      targetId: pageId,
      metadata: { workspaceType: page.workspaceType, soft: true },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const title = body.title.trim();
  if (!title) {
    return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
  }

  await prisma.page.update({
    where: { id: pageId },
    data: { title, lastEditedById: auth.user.sub },
  });
  return withCors(request, Response.json({ ok: true }));
}
