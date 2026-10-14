import type { Route } from "./+types/api.documents.$id";
import type { AuthSuccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess, requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { getPageAccess } from "~/lib/pageAccess.server";
import { loadManageableNotebook, notebookErrorResponse, trashNotebook } from "~/lib/notebooks.server";
import { isRoot, ROOT_DELETE_ERROR, CLEARED_FOLDER_TYPE } from "~/lib/drive-roots";

// POST   /api/documents/:id — partial update. Body: any of
//                             { title?, iconEmoji?, coverImageUrl? }.
// DELETE /api/documents/:id — archive (sets archivedAt; archived pages drop
//                             out of the hub / workspace list by default). A
//                             notebook is archived with its tabs.
//                             `?ifEmpty=1` on a Notebook refuses (409) while it
//                             still holds live notes.
//
// Documents are FreeForm Pages. Project-scoped pages use the project-edit gate
// (isCore === Admin || Core, or a project assignee). Lab, EducationOffering and
// Member pages resolve through getPageAccess, which is the only gate that
// understands a folder scope, a note's owner, or a share list.
//
// Lab used to take the bare lab-member gate, on the reasoning that the lab's
// members are the Lab workspace's members. But the Lab workspace also holds the
// Core-scoped folders, so that let any member rename or delete Core's
// Agreements folder through this endpoint — the Drive hides those folders, the
// API didn't. getPageAccess reads the folder scope and closes it.
//
// EducationOffering is handled here now rather than 404ing: the Drive's
// Education space routes rename and delete through this same endpoint, so
// without it neither worked anywhere in that space.
//
// Member pages (personal notes in My Drive): the doc editor's title box posts
// here for every workspace, so this branch is what makes renaming a note from
// the document itself work. Archiving one still belongs to /api/notes, so
// DELETE stays owner-only.

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
    select: { id: true, workspaceType: true, workspaceId: true, kind: true, folderType: true },
  });
  if (
    !page ||
    (page.workspaceType !== "Project" &&
      page.workspaceType !== "Lab" &&
      page.workspaceType !== "EducationOffering" &&
      page.workspaceType !== "Member") ||
    (page.workspaceType !== "Lab" && !page.workspaceId)
  ) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }
  let auth: AuthSuccess;
  if (page.workspaceType === "Lab" || page.workspaceType === "EducationOffering") {
    const gate = await requireMemberSession(request);
    if (!gate.ok) return withCors(request, gate.response);
    auth = gate.auth;
    // getPageAccess, not a bare role check: it is the only gate that walks the
    // folder scope, so a Core-scoped Lab folder stays Core's. 404 rather than
    // 403 so the endpoint doesn't confirm a page the caller can't see.
    const access = await getPageAccess(auth.user.sub, pageId, request);
    if (!access.canEdit) {
      return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
    }
  } else if (page.workspaceType === "Member") {
    const gate = await requireMemberSession(request);
    if (!gate.ok) return withCors(request, gate.response);
    auth = gate.auth;
    const isOwner = page.workspaceId === auth.user.sub;
    // DELETE archives the note, which is the owner's call alone; a metadata
    // edit follows the note's own edit grant (owner or an Edit/Full share).
    const allowed =
      request.method === "DELETE"
        ? isOwner
        : isOwner || (await getPageAccess(auth.user.sub, pageId, request)).canEdit;
    if (!allowed) {
      return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
    }
  } else {
    const gate = await requireProjectEditAccess(request, page.workspaceId!);
    if (!gate.ok) return gate.response;
    auth = gate.auth;
  }

  if (request.method === "DELETE") {
    if (isRoot(page)) {
      return withCors(request, Response.json({ error: ROOT_DELETE_ERROR }, { status: 400 }));
    }
    if (page.kind === "Notebook") {
      // The filing toast's Undo asks for a notebook to go only if the note it
      // just removed was its last, so a note filed in the meantime keeps it.
      if (new URL(request.url).searchParams.get("ifEmpty") === "1") {
        const notes = await prisma.page.count({ where: { parentPageId: pageId, archivedAt: null } });
        if (notes > 0) {
          return withCors(request, Response.json({ error: "This notebook still has notes." }, { status: 409 }));
        }
      }
      // The tabs go to Trash with their notebook, and come back with it.
      try {
        await trashNotebook(pageId, auth.user.sub);
      } catch (err) {
        return withCors(request, notebookErrorResponse(err));
      }
      await logAuditEvent({
        action: "document.delete",
        userId: auth.user.sub,
        targetId: pageId,
        metadata: { workspaceType: page.workspaceType, soft: true, notebook: true },
        request,
      });
      return withCors(request, Response.json({ ok: true }));
    }
    if (page.kind === "Folder") {
      // "Empty" has to mean empty of everything a folder can hold, not just of
      // sub-pages. Files, agreements and rubrics are filed by folderPageId, and
      // archiving the folder out from under them leaves rows pointing at a dead
      // parent, which would be silently unreachable. Forms are pages, so they
      // are counted with the sub-pages.
      const [pages, files, agreements, rubrics] = await Promise.all([
        prisma.page.count({ where: { parentPageId: pageId, archivedAt: null } }),
        prisma.projectFile.count({ where: { folderPageId: pageId, archivedAt: null } }),
        prisma.signingDocument.count({ where: { folderPageId: pageId, archivedAt: null } }),
        prisma.rubric.count({ where: { folderPageId: pageId } }),
      ]);
      const total = pages + files + agreements + rubrics;
      if (total > 0) {
        return withCors(
          request,
          Response.json(
            {
              error: `This folder still holds ${total} ${total === 1 ? "item" : "items"}. Move or delete them first.`,
            },
            { status: 400 },
          ),
        );
      }
    }
    await prisma.page.update({
      where: { id: pageId },
      data: { archivedAt: new Date(), ...CLEARED_FOLDER_TYPE },
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
    if (page.kind === "Notebook") {
      try {
        await loadManageableNotebook(pageId, auth.user.sub, request);
      } catch (err) {
        return withCors(request, notebookErrorResponse(err));
      }
    }
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
