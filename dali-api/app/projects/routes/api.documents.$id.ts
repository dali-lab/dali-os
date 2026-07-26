import type { Route } from "./+types/api.documents.$id";
import type { AuthSuccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess, requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

// POST   /api/documents/:id — partial update. Body: any of
//                             { title?, iconEmoji?, coverImageUrl? }.
// DELETE /api/documents/:id — archive (sets archivedAt; archived pages drop
//                             out of the hub / workspace list by default).
//
// Documents are FreeForm Pages. Project-scoped pages use the project-edit gate
// (isCore === Admin || Core, or a project assignee); Lab-scoped pages (the
// lab-wide Documents area) use the lab-member gate — the lab's members are the
// Lab workspace's members, mirroring project membership. EducationOffering
// pages are not handled here (they keep their existing behavior); parity is a
// follow-up.

type Body = { title?: string; iconEmoji?: string | null; coverImageUrl?: string | null };

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  const okTitle = b.title === undefined || typeof b.title === "string";
  const okIcon = b.iconEmoji === undefined || isNullableString(b.iconEmoji);
  const okCover = b.coverImageUrl === undefined || isNullableString(b.coverImageUrl);
  const hasOne =
    b.title !== undefined || b.iconEmoji !== undefined || b.coverImageUrl !== undefined;
  return okTitle && okIcon && okCover && hasOne;
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
  if (
    !page ||
    (page.workspaceType !== "Project" && page.workspaceType !== "Lab") ||
    (page.workspaceType === "Project" && !page.workspaceId)
  ) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }
  let auth: AuthSuccess;
  if (page.workspaceType === "Lab") {
    const gate = await requireMemberSession(request);
    if (!gate.ok) return withCors(request, gate.response);
    auth = gate.auth;
  } else {
    const gate = await requireProjectEditAccess(request, page.workspaceId!);
    if (!gate.ok) return gate.response;
    auth = gate.auth;
  }

  if (request.method === "DELETE") {
    if (page.systemKey) {
      return withCors(
        request,
        Response.json({ error: "This default folder can't be archived" }, { status: 400 }),
      );
    }
    if (page.kind === "Folder") {
      const childCount = await prisma.page.count({
        where: { parentPageId: pageId, archivedAt: null },
      });
      if (childCount > 0) {
        return withCors(
          request,
          Response.json({ error: "Move or archive the documents inside this folder first" }, { status: 400 }),
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

  const data: {
    title?: string;
    iconEmoji?: string | null;
    coverImageUrl?: string | null;
    lastEditedById: string;
  } = { lastEditedById: auth.user.sub };

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) {
      return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
    }
    data.title = title;
  }
  if (body.iconEmoji !== undefined) {
    const icon = typeof body.iconEmoji === "string" ? body.iconEmoji.trim() : "";
    data.iconEmoji = icon || null;
  }
  if (body.coverImageUrl !== undefined) {
    const cover = typeof body.coverImageUrl === "string" ? body.coverImageUrl.trim() : "";
    data.coverImageUrl = cover || null;
  }

  await prisma.page.update({ where: { id: pageId }, data });
  return withCors(request, Response.json({ ok: true }));
}
