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
import type { Prisma, WorkspaceType } from "~/generated/prisma/client";
import { pageDepth, MAX_PAGE_DEPTH, isAncestorOf, collectSubtree } from "~/lib/pages";
import { isUnderGoverningScope } from "~/lib/pageAccess.server";

// POST /api/pages/:id/move — move and/or reorder a document.
//   { parentPageId, beforeId? }                  → reorder within its workspace
//   { parentPageId, beforeId?, workspaceType, workspaceId } → move to another
//     workspace (Lab ↔ Project, Project ↔ Project). Moving a doc into a project
//     IS adding it to that project (membership is just these two columns).
//
// A personal note (Member workspace, i.e. My Drive) is a valid SOURCE: the
// owner may hand a note to a shared drive. Member is not a destination — see
// BodySchema — so this is a one-way trip out of My Drive.
//
// Same-workspace reorder is unchanged when the workspace fields are omitted.
// Docs and folders alike nest under any Folder up to MAX_PAGE_DEPTH, guarded by
// a depth check and an ancestor cycle check below. Cross-workspace: the actor
// must be able to manage the doc where
// it lives AND edit in the destination; system folders and a project's
// Overview/PRD can't leave; partner/public sharing and the pin reset on the way
// out. The collab room (doc:{pageId}:body) is workspace-independent, so content
// is untouched.
//
// A FOLDER moves as a whole subtree. Placement and scope are separate columns
// in this model — a page carries workspaceType/workspaceId, a file carries
// projectId or workspaceType/workspaceId, and both are found through a
// parentPageId/folderPageId chain — so a move that rewrites only the folder row
// leaves everything under it pointing into a workspace it no longer belongs to.
// Such a row is listed by neither drive (the old one no longer holds its
// parent, the new one filters it out by scope) and vanishes. So the move
// rewrites every descendant page AND every file filed anywhere inside.
// Agreements and rubrics have no scope column at all and only the Lab drive
// lists them, so a folder holding one is refused a trip out of Lab.

const BodySchema = z.object({
  parentPageId: z.string().min(1).nullable(),
  beforeId: z.string().min(1).nullable().optional(),
  // Destination workspace. Omit both for a same-workspace reorder.
  // Member is intentionally excluded as a DESTINATION: nothing may be pulled
  // out of a shared drive into someone's private space. Moving the other way
  // (a note leaving My Drive) is allowed — see the source guard below.
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
      partnerVisible: true,
      publicVisible: true,
      projectAsOverview: { select: { id: true } },
      projectAsPRD: { select: { id: true } },
    },
  });
  // A movable source is a live page in one of the four workspaces, carrying the
  // workspaceId shape that workspace implies: Lab is lab-wide (null), the other
  // three are scoped to a project / offering / note owner.
  const sourceShapeOk =
    page?.workspaceType === "Lab"
      ? page.workspaceId === null
      : (page?.workspaceType === "Project" ||
          page?.workspaceType === "EducationOffering" ||
          page?.workspaceType === "Member") &&
        page.workspaceId !== null;
  if (!page || !sourceShapeOk || page.archivedAt !== null) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  // Destination. Absent workspaceType → reorder in place.
  let dest: { type: WorkspaceType; id: string | null };
  if (!body.workspaceType) {
    dest = { type: page.workspaceType, id: page.workspaceId };
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
    if (page.projectAsOverview || page.projectAsPRD) {
      return withCors(request, Response.json({ error: "The Overview and PRD docs can't be moved out of their project" }, { status: 400 }));
    }
  }

  // A folder moves as a whole subtree, so everything below depends on knowing
  // it up front: the depth guard, the per-page workspace rewrite, the
  // Restricted push, and the files filed anywhere inside it.
  const subtree = page.kind === "Folder" ? await collectSubtree(pageId) : { ids: [], height: 0 };
  // `folderPageId` can only point at a Folder, so passing every descendant id
  // here is harmless — the non-folders simply never match.
  const subtreeFolderIds = page.kind === "Folder" ? [pageId, ...subtree.ids] : [];

  // Agreements and rubrics are filed by `folderPageId` alone — unlike pages and
  // files they carry no project/offering scope column, and only the Lab drive
  // loads them. A folder holding one can't leave the Lab workspace without
  // stranding it somewhere nothing lists it.
  if (!sameWorkspace && page.workspaceType === "Lab" && subtreeFolderIds.length > 0) {
    const [agreements, rubrics] = await Promise.all([
      prisma.signingDocument.count({
        where: { folderPageId: { in: subtreeFolderIds }, archivedAt: null },
      }),
      prisma.rubric.count({ where: { folderPageId: { in: subtreeFolderIds } } }),
    ]);
    if (agreements + rubrics > 0) {
      return withCors(
        request,
        Response.json(
          { error: "This folder holds agreements or rubrics, which only live in the Lab drive. Move them out first." },
          { status: 400 },
        ),
      );
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
    // The moved page lands one below its new parent, and its own subtree keeps
    // going from there — so a 3-deep folder needs 3 levels of headroom, not 1.
    // Checking only the parent let a subtree settle past MAX_PAGE_DEPTH, deeper
    // than the ancestry walk in getPageAccess reaches.
    const depth = await pageDepth(body.parentPageId);
    if (depth < 0 || depth + 1 + subtree.height > MAX_PAGE_DEPTH) {
      return withCors(request, Response.json({ error: "Folder is too deeply nested" }, { status: 400 }));
    }
    // Cycle guard: the destination can't be a descendant of the page being moved.
    if (await isAncestorOf(pageId, body.parentPageId)) {
      return withCors(request, Response.json({ error: "A document can't be moved into its own descendant" }, { status: 400 }));
    }
    parentPageId = body.parentPageId;
  }

  // When a folder crosses workspaces its whole subtree comes along — not just
  // the direct children. A grandchild left on the old workspace is filtered out
  // of the new drive (wrong workspace) AND out of the old one (its parent
  // left), so it disappears from the Drive entirely.
  const movedPageIds = !sameWorkspace ? subtree.ids : [];

  // Files are placed by `folderPageId` but scoped by their own columns, so a
  // cross-workspace move has to rewrite both. Leaving the scope behind strands
  // every upload inside the folder exactly the way a stale grandchild strands.
  const movedFileIds =
    !sameWorkspace && subtreeFolderIds.length > 0
      ? (
          await prisma.projectFile.findMany({
            where: { folderPageId: { in: subtreeFolderIds }, archivedAt: null },
            select: { id: true },
          })
        ).map((f) => f.id)
      : [];
  // Forms need no equivalent: `Form` has no scope column — loadForms resolves a
  // form's drive purely from the folder it points at, which just moved.
  const fileScope: Prisma.ProjectFileUncheckedUpdateManyInput =
    dest.type === "Project"
      ? { projectId: dest.id, workspaceType: null, workspaceId: null }
      : dest.type === "Lab"
        ? { projectId: null, workspaceType: "Lab", workspaceId: null }
        : { projectId: null, workspaceType: "EducationOffering", workspaceId: dest.id };
  const fileData: Prisma.ProjectFileUncheckedUpdateManyInput = {
    ...fileScope,
    // Same resets the pages get: partner sharing is Project-only, and a session
    // link only means anything inside the offering it was pinned to.
    ...(page.workspaceType === "Project" ? { partnerVisible: false } : {}),
    ...(page.workspaceType === "EducationOffering" ? { sessionId: null } : {}),
  };

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
  // Leaving My Drive: the personal-note flags (profile visibility and the
  // lab-listing proposal state) are Member-workspace concepts, so they go with
  // it — same reasoning as partner/public sharing on the way out of a project.
  const leavesMember = page.workspaceType === "Member";
  const personalReset: Prisma.PageUncheckedUpdateInput = leavesMember
    ? { profileVisible: false, labListing: "None", labListingNote: null }
    : {};
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
        ...personalReset,
        ...destGeneralAccess,
      };
  const childData: Prisma.PageUncheckedUpdateInput = {
    workspaceType: dest.type,
    workspaceId: dest.id,
    ...(leavesProject ? { partnerVisible: false, publicVisible: false } : {}),
    ...personalReset,
    ...destGeneralAccess,
  };

  // Moving a folder INTO a scope: every descendant must go Restricted too, or a
  // lab-visible child would keep leaking through the scoped folder. A
  // cross-workspace move already pushes that down via childData, so this list
  // only has to cover the descendants that move didn't touch.
  const restrictOnlyIds = destScoped
    ? subtree.ids.filter((id) => !movedPageIds.includes(id))
    : [];

  await prisma.$transaction([
    prisma.page.update({ where: { id: pageId }, data: { parentPageId, ...crossData } }),
    ...(movedPageIds.length
      ? [prisma.page.updateMany({ where: { id: { in: movedPageIds } }, data: childData })]
      : []),
    ...(restrictOnlyIds.length
      ? [
          prisma.page.updateMany({
            where: { id: { in: restrictOnlyIds } },
            data: { linkAccess: "Restricted", linkPermission: "View" },
          }),
        ]
      : []),
    ...(movedFileIds.length
      ? [prisma.projectFile.updateMany({ where: { id: { in: movedFileIds } }, data: fileData })]
      : []),
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
        descendantCount: movedPageIds.length,
        fileCount: movedFileIds.length,
      },
      request,
    });
  }

  return withCors(request, Response.json({ ok: true }));
}

