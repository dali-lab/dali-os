import type { Route } from "./+types/api.pages.$id.move";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { logAuditEvent } from "~/lib/audit";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import type { Prisma } from "~/generated/prisma/client";
import { pageDepth, MAX_PAGE_DEPTH, isAncestorOf } from "~/lib/pages";
import { isUnderGoverningScope } from "~/lib/pageAccess.server";

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
  // Member is intentionally excluded (privacy — personal notes stay private).
  // EducationOffering is now a valid destination (Drive-space move into a
  // course workspace). Lab and Project remain as before.
  workspaceType: z.enum(["Lab", "Project", "EducationOffering"]).optional(),
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
    (page.workspaceType !== "Lab" && page.workspaceType !== "Project" && page.workspaceType !== "EducationOffering") ||
    (page.workspaceType === "Lab" ? page.workspaceId !== null : !page.workspaceId) ||
    page.archivedAt !== null
  ) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  // Destination. Absent workspaceType → reorder in place.
  let dest: { type: "Lab" | "Project" | "EducationOffering"; id: string | null };
  if (!body.workspaceType) {
    dest = {
      type: page.workspaceType as "Lab" | "Project" | "EducationOffering",
      id: page.workspaceId,
    };
  } else if (body.workspaceType === "Lab") {
    dest = { type: "Lab", id: null };
  } else {
    if (!body.workspaceId) {
      return withCors(
        request,
        Response.json({ error: "Workspace destination needs a workspaceId" }, { status: 400 }),
      );
    }
    dest = { type: body.workspaceType, id: body.workspaceId };
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
    let canDest: boolean;
    if (dest.type === "Lab") {
      canDest = await isLabMember(userId);
    } else if (dest.type === "EducationOffering") {
      // Only instructors for this offering (or Core) may add docs to its Drive.
      canDest = await isOfferingManager(userId, dest.id!);
    } else {
      canDest = (await isCore(userId)) || (await isProjectMember(userId, dest.id!));
    }
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
  // Does the destination sit inside a scoped drive (e.g. Core)? Then the page —
  // and any descendants coming with it — must go Restricted so the scope, not
  // the lab-wide link grant, governs access (otherwise "Everyone in the lab"
  // would keep it visible inside a Core folder).
  const destScoped = await isUnderGoverningScope(parentPageId);
  // General access is workspace-specific, so reset it on every cross-workspace
  // move: a doc landing on the Lab shelf becomes lab-wide editable (the shelf's
  // default), and one leaving the shelf drops back to its workspace's own rules.
  // A scoped destination overrides that to Restricted.
  const destGeneralAccess: Prisma.PageUncheckedUpdateInput =
    destScoped || dest.type !== "Lab"
      ? { linkAccess: "Restricted", linkPermission: "View" }
      : { linkAccess: "LabMembers", linkPermission: "Edit" };
  const crossData: Prisma.PageUncheckedUpdateInput = sameWorkspace
    ? // Same-workspace: only touch general access when moving INTO a scope (fail
      // safe — leave the user's setting alone otherwise).
      destScoped
      ? { linkAccess: "Restricted", linkPermission: "View" }
      : {}
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

  // Moving a folder INTO a scope: every descendant must go Restricted too, or a
  // lab-visible child would keep leaking through the scoped folder. (Cross-
  // workspace folder moves already carry direct children via childIds/childData;
  // this covers the same-workspace-into-scope case and deep descendants.)
  const descendantRestrictIds: string[] =
    destScoped && page.kind === "Folder" ? await collectDescendantIds(pageId) : [];

  await prisma.$transaction([
    prisma.page.update({ where: { id: pageId }, data: { parentPageId, ...crossData } }),
    ...childIds.map((id) => prisma.page.update({ where: { id }, data: childData })),
    ...descendantRestrictIds
      .filter((id) => !childIds.includes(id))
      .map((id) =>
        prisma.page.update({
          where: { id },
          data: { linkAccess: "Restricted", linkPermission: "View" },
        }),
      ),
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

// Every descendant page id of `rootId` (exclusive). Iterative BFS, bounded by
// MAX_PAGE_DEPTH so cyclic/broken data can't loop. Used to push Restricted
// general access down a folder subtree when it moves into a scoped drive.
async function collectDescendantIds(rootId: string): Promise<string[]> {
  const out: string[] = [];
  let frontier = [rootId];
  for (let depth = 0; depth < MAX_PAGE_DEPTH && frontier.length > 0; depth++) {
    const children = await prisma.page.findMany({
      where: { parentPageId: { in: frontier }, archivedAt: null },
      select: { id: true },
    });
    const ids = children.map((c) => c.id).filter((id) => !out.includes(id) && id !== rootId);
    if (ids.length === 0) break;
    out.push(...ids);
    frontier = ids;
  }
  return out;
}
