import type { Route } from "./+types/api.pages.$id.move";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { canManageSharing } from "~/lib/page-share-access.server";
import { logAuditEvent } from "~/lib/audit";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import type { Prisma } from "~/generated/prisma/client";
import { pageDepth, MAX_PAGE_DEPTH, isAncestorOf } from "~/lib/pages";

// POST /api/pages/:id/move — move and/or reorder a document.
//   { parentPageId, beforeId? }                  → reorder within its workspace
//   { parentPageId, beforeId?, workspaceType, workspaceId } → move to another
//     workspace (Lab ↔ Project, Project ↔ Project). Moving a doc into a project
//     IS adding it to that project (membership is just these two columns).
//
// Same-workspace reorder is unchanged when the workspace fields are omitted.
// Docs and folders alike nest under any Folder up to MAX_PAGE_DEPTH, guarded by
// a depth check and an ancestor cycle check below. Cross-workspace: the actor
// must be able to manage the doc where
// it lives AND edit in the destination; system folders and a project's
// Overview/PRD can't leave; partner/public sharing and the pin reset on the way
// out. The collab room (doc:{pageId}:body) is workspace-independent, so content
// is untouched.

const BodySchema = z.object({
  parentPageId: z.string().min(1).nullable(),
  beforeId: z.string().min(1).nullable().optional(),
  // Destination workspace. Omit both for a same-workspace reorder.
  // EducationOffering/Member are intentionally not movable (enrollment /
  // privacy audiences), so the enum rejects them.
  workspaceType: z.enum(["Lab", "Project"]).optional(),
  workspaceId: z.string().min(1).nullable().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;
  const pageId = params.id!;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      workspaceType: true,
      workspaceId: true,
      kind: true,
      archivedAt: true,
      createdById: true,
      systemKey: true,
      partnerVisible: true,
      publicVisible: true,
      projectAsOverview: { select: { id: true } },
      projectAsPRD: { select: { id: true } },
    },
  });
  if (
    !page ||
    (page.workspaceType !== "Lab" && page.workspaceType !== "Project") ||
    (page.workspaceType === "Lab" ? page.workspaceId !== null : !page.workspaceId) ||
    page.archivedAt !== null
  ) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  // Destination. Absent workspaceType → reorder in place.
  let dest: { type: "Lab" | "Project"; id: string | null };
  if (!body.workspaceType) {
    dest = { type: page.workspaceType as "Lab" | "Project", id: page.workspaceId };
  } else if (body.workspaceType === "Lab") {
    dest = { type: "Lab", id: null };
  } else {
    if (!body.workspaceId) {
      return withCors(request, Response.json({ error: "Project destination needs a workspaceId" }, { status: 400 }));
    }
    dest = { type: "Project", id: body.workspaceId };
  }
  const sameWorkspace = dest.type === page.workspaceType && dest.id === page.workspaceId;

  // Source authority: must be able to manage this doc where it currently lives.
  const canManageSource = await canManageSharing(
    {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      createdById: page.createdById,
    },
    userId,
  );
  if (!canManageSource) {
    return withCors(request, Response.json({ error: "You can't move this document" }, { status: 403 }));
  }

  // Destination authority (cross-workspace only): must be able to edit there.
  if (!sameWorkspace) {
    const canDest =
      dest.type === "Lab"
        ? await isLabMember(userId)
        : (await isCore(userId)) || (await isProjectMember(userId, dest.id!));
    if (!canDest) {
      return withCors(request, Response.json({ error: "You can't move documents into that destination" }, { status: 403 }));
    }
  }

  // Guardrails.
  if (body.parentPageId === pageId) {
    return withCors(request, Response.json({ error: "A document can't be moved into itself" }, { status: 400 }));
  }
  if (!sameWorkspace) {
    if (page.systemKey) {
      return withCors(request, Response.json({ error: "This default folder can't be moved to another workspace" }, { status: 400 }));
    }
    if (page.projectAsOverview || page.projectAsPRD) {
      return withCors(request, Response.json({ error: "The Overview and PRD docs can't be moved out of their project" }, { status: 400 }));
    }
  }

  // Parent folder (if nesting) must live in the DESTINATION; depth ≤ MAX_PAGE_DEPTH.
  let parentPageId: string | null = null;
  if (body.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: body.parentPageId },
      select: { workspaceType: true, workspaceId: true, parentPageId: true, kind: true, archivedAt: true },
    });
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== dest.type ||
      parent.workspaceId !== dest.id
    ) {
      return withCors(request, Response.json({ error: "Folder not found" }, { status: 404 }));
    }
    if (parent.kind !== "Folder") {
      return withCors(request, Response.json({ error: "Documents can only nest inside a folder" }, { status: 400 }));
    }
    const depth = await pageDepth(body.parentPageId);
    if (depth < 0 || depth >= MAX_PAGE_DEPTH) {
      return withCors(request, Response.json({ error: "Folder is too deeply nested" }, { status: 400 }));
    }
    // Cycle guard: the destination can't be a descendant of the page being moved.
    if (await isAncestorOf(pageId, body.parentPageId)) {
      return withCors(request, Response.json({ error: "A document can't be moved into its own descendant" }, { status: 400 }));
    }
    parentPageId = body.parentPageId;
  }

  // When a folder crosses workspaces, its children come along (their workspace
  // columns change; they stay under the folder with their own positions).
  const childIds =
    page.kind === "Folder" && !sameWorkspace
      ? (
          await prisma.page.findMany({
            where: { parentPageId: pageId, archivedAt: null },
            select: { id: true },
          })
        ).map((c) => c.id)
      : [];

  // Rebuild the destination sibling order (in the destination workspace).
  const siblings = await prisma.page.findMany({
    where: { workspaceType: dest.type, workspaceId: dest.id, parentPageId, archivedAt: null },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const order = siblings.map((s) => s.id).filter((id) => id !== pageId);
  const beforeIndex = body.beforeId ? order.indexOf(body.beforeId) : -1;
  if (beforeIndex >= 0) order.splice(beforeIndex, 0, pageId);
  else order.push(pageId);

  const leavesProject = page.workspaceType === "Project" && dest.type !== "Project";
  // General access is workspace-specific, so reset it on every cross-workspace
  // move: a doc landing on the Lab shelf becomes lab-wide editable (the shelf's
  // default), and one leaving the shelf drops back to its workspace's own rules
  // — otherwise "Everyone in the lab" edit would follow it into a project doc.
  const destGeneralAccess: Prisma.PageUncheckedUpdateInput =
    dest.type === "Lab"
      ? { linkAccess: "LabMembers", linkPermission: "Edit" }
      : { linkAccess: "Restricted", linkPermission: "View" };
  const crossData: Prisma.PageUncheckedUpdateInput = sameWorkspace
    ? {}
    : {
        workspaceType: dest.type,
        workspaceId: dest.id,
        // A pin means "top of THIS view", so it doesn't carry across a move.
        pinnedAt: null,
        // partner/public sharing is Project-only — clear it when leaving.
        ...(leavesProject ? { partnerVisible: false, publicVisible: false } : {}),
        ...destGeneralAccess,
      };
  const childData: Prisma.PageUncheckedUpdateInput = {
    workspaceType: dest.type,
    workspaceId: dest.id,
    ...(leavesProject ? { partnerVisible: false, publicVisible: false } : {}),
    ...destGeneralAccess,
  };

  await prisma.$transaction([
    prisma.page.update({ where: { id: pageId }, data: { parentPageId, ...crossData } }),
    ...childIds.map((id) => prisma.page.update({ where: { id }, data: childData })),
    ...order.map((id, index) => prisma.page.update({ where: { id }, data: { position: index } })),
  ]);

  if (!sameWorkspace) {
    await logAuditEvent({
      action: "page.move-workspace",
      userId,
      targetId: pageId,
      metadata: {
        from: { type: page.workspaceType, id: page.workspaceId },
        to: { type: dest.type, id: dest.id },
        kind: page.kind,
        childCount: childIds.length,
      },
      request,
    });
  }

  return withCors(request, Response.json({ ok: true }));
}
