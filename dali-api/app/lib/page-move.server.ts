import { z } from "zod";
import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { logAuditEvent } from "~/lib/audit";
import type { Prisma, WorkspaceType } from "~/generated/prisma/client";
import { MAX_PAGE_DEPTH, collectSubtree } from "~/lib/pages";
import { loadAncestorChain, chainDepth, chainHasAncestor, chainGoverningScope } from "~/lib/page-ancestry.server";
import { isRoot, nearestRoot, rootBoundMoveError, ROOT_MOVE_ERROR, SYSTEM_FOLDER_MOVE_ERROR } from "~/lib/drive-roots";
import { clearTypeIfLeavingRoot } from "~/lib/drive-receivers.server";
import { findNameConflict } from "~/lib/page-names.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { addToNotebook, loadManageableNotebook, notebookErrorResponse } from "~/lib/notebooks.server";

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

export const MovePageBodySchema = z.object({
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

export type MovePageBody = z.infer<typeof MovePageBodySchema>;

export type MovedFrom = {
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  parentPageId: string | null;
};

export type MovePageResult =
  | { ok: true; clearedReceivers: string[]; from: MovedFrom }
  | { ok: false; status: number; error: string }
  | { ok: false; response: Response };

function fail(status: number, error: string): MovePageResult {
  return { ok: false, status, error };
}

async function canEditDestination(userId: string, dest: { type: WorkspaceType; id: string | null }) {
  if (dest.type === "Lab") return isLabMember(userId);
  // Only instructors for this offering (or Core) may add docs to its Drive.
  if (dest.type === "EducationOffering") return isOfferingManager(userId, dest.id!);
  return (await isCore(userId)) || (await isProjectMember(userId, dest.id!));
}

async function countHeldArtifacts(folderIds: string[]) {
  if (folderIds.length === 0) return 0;
  const [agreements, rubrics] = await Promise.all([
    prisma.signingDocument.count({ where: { folderPageId: { in: folderIds }, archivedAt: null } }),
    prisma.rubric.count({ where: { folderPageId: { in: folderIds } } }),
  ]);
  return agreements + rubrics;
}

async function findFilesInFolders(folderIds: string[]) {
  if (folderIds.length === 0) return [];
  const files = await prisma.projectFile.findMany({
    where: { folderPageId: { in: folderIds }, archivedAt: null },
    select: { id: true },
  });
  return files.map((f) => f.id);
}

/**
 * The move route's whole body, callable from other server code. `input` is the
 * parsed body, or a thunk that parses it: the route parses after the source
 * checks, and a thunk keeps that error ordering.
 */
export async function movePage({
  pageId,
  userId,
  request,
  input,
}: {
  pageId: string;
  userId: string;
  request?: Request;
  input: MovePageBody | (() => Promise<MovePageBody | Response>);
}): Promise<MovePageResult> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      parentPageId: true,
      workspaceType: true,
      workspaceId: true,
      kind: true,
      folderType: true,
      archivedAt: true,
      createdById: true,
      partnerVisible: true,
      publicVisible: true,
      projectAsOverview: { select: { id: true } },
      projectAsPRD: { select: { id: true } },
      parent: { select: { id: true, kind: true, archivedAt: true } },
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
    return fail(404, "Document not found");
  }

  if (isRoot(page)) {
    return fail(400, ROOT_MOVE_ERROR);
  }

  const from: MovedFrom = {
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    parentPageId: page.parentPageId,
  };
  const resolved = typeof input === "function" ? await input() : input;
  if (resolved instanceof Response) return { ok: false, response: resolved };
  const body = resolved;

  if (
    page.parent?.kind === "Notebook" &&
    page.parent.archivedAt === null &&
    body.parentPageId !== page.parent.id
  ) {
    try {
      await loadManageableNotebook(page.parent.id, userId, request);
    } catch (err) {
      return { ok: false, response: notebookErrorResponse(err) };
    }
  }

  // Destination. Absent workspaceType → reorder in place.
  let dest: { type: WorkspaceType; id: string | null };
  if (!body.workspaceType) {
    dest = { type: page.workspaceType, id: page.workspaceId };
  } else if (body.workspaceType === "Lab") {
    dest = { type: "Lab", id: null };
  } else {
    if (!body.workspaceId) {
      return fail(400, "Workspace destination needs a workspaceId");
    }
    dest = { type: body.workspaceType, id: body.workspaceId };
  }
  const sameWorkspace = dest.type === page.workspaceType && dest.id === page.workspaceId;
  if (page.folderType && !sameWorkspace) return fail(400, SYSTEM_FOLDER_MOVE_ERROR);

  // None of these reads depends on another, so they run together; their results
  // are then checked in the order the refusals have always taken precedence.
  const needsFiles = !sameWorkspace && page.kind === "Folder";
  const subtreePending: Promise<{ ids: string[]; height: number }> =
    page.kind === "Folder" || page.kind === "Notebook"
      ? collectSubtree(pageId)
      : Promise.resolve({ ids: [], height: 0 });
  // `folderPageId` can only point at a Folder, so passing every descendant id
  // here is harmless — the non-folders simply never match.
  const folderIdsPending = subtreePending.then((subtree) =>
    page.kind === "Folder" ? [pageId, ...subtree.ids] : [],
  );
  const parentChainPending = body.parentPageId
    ? loadAncestorChain(body.parentPageId)
    : Promise.resolve([]);
  const sourceChainPending = page.parentPageId
    ? loadAncestorChain(page.parentPageId)
    : Promise.resolve([]);
  const appendOnly = !body.beforeId;
  const siblingScope = {
    workspaceType: dest.type,
    workspaceId: dest.id,
    parentPageId: body.parentPageId,
    archivedAt: null,
  };

  const [
    canManageSource,
    canDest,
    subtree,
    subtreeFolderIds,
    parentChain,
    sourceChain,
    parentAccess,
    heldArtifacts,
    movedFileIds,
    siblings,
    lastPosition,
  ] = await Promise.all([
    // Source authority: must be able to manage this doc where it currently lives.
    canManageSharing(
      {
        id: page.id,
        workspaceType: page.workspaceType,
        workspaceId: page.workspaceId,
        createdById: page.createdById,
      },
      userId,
    ),
    // Destination authority (cross-workspace only): must be able to edit there.
    sameWorkspace ? Promise.resolve(true) : canEditDestination(userId, dest),
    subtreePending,
    folderIdsPending,
    parentChainPending,
    sourceChainPending,
    // Being able to edit in the destination WORKSPACE is not the same as being
    // able to edit in the destination FOLDER: any lab member passes the Lab
    // check, scoped folders included. Without this, a member could file a doc
    // into Core's drive — and immediately lose it, since landing in a scope
    // forces the page Restricted. /api/drive/move already checks this for
    // files and forms; pages were the gap.
    body.parentPageId ? getPageAccess(userId, body.parentPageId, request) : Promise.resolve(null),
    // Agreements and rubrics are filed by `folderPageId` alone — unlike pages and
    // files they carry no project/offering scope column, and only the Lab drive
    // loads them. A folder holding one can't leave the Lab workspace without
    // stranding it somewhere nothing lists it.
    !sameWorkspace && page.workspaceType === "Lab"
      ? folderIdsPending.then(countHeldArtifacts)
      : Promise.resolve(0),
    // Files are placed by `folderPageId` but scoped by their own columns, so a
    // cross-workspace move has to rewrite both. Leaving the scope behind strands
    // every upload inside the folder exactly the way a stale grandchild strands.
    // Forms need no equivalent: a form is a Page, so it travels with the subtree.
    needsFiles ? folderIdsPending.then(findFilesInFolders) : Promise.resolve([] as string[]),
    appendOnly
      ? Promise.resolve([] as { id: string }[])
      : prisma.page.findMany({
          where: siblingScope,
          orderBy: { position: "asc" },
          select: { id: true },
        }),
    appendOnly
      ? prisma.page.aggregate({
          where: { ...siblingScope, id: { not: pageId } },
          _max: { position: true },
        })
      : Promise.resolve(null),
  ]);

  if (!canManageSource) {
    return fail(403, "You can't move this document");
  }
  if (!canDest) {
    return fail(403, "You can't move documents into that destination");
  }

  const rootRefusal = rootBoundMoveError(nearestRoot(sourceChain), nearestRoot(parentChain));
  if (rootRefusal) return fail(400, rootRefusal);

  // Guardrails.
  if (body.parentPageId === pageId) {
    return fail(400, "A document can't be moved into itself");
  }
  if (!sameWorkspace) {
    if (page.projectAsOverview || page.projectAsPRD) {
      return fail(400, "The Overview and PRD docs can't be moved out of their project");
    }
  }
  if (heldArtifacts > 0) {
    return fail(400, "This folder holds agreements or rubrics, which only live in the Lab drive. Move them out first.");
  }

  // Parent folder (if nesting) must live in the DESTINATION; depth ≤ MAX_PAGE_DEPTH.
  let parentPageId: string | null = null;
  if (body.parentPageId) {
    const parent = parentChain[0];
    // A notebook is a valid parent for documents and notes only, and the tab
    // takes the notebook's workspace, so the destination workspace is moot.
    if (parent && parent.kind === "Notebook" && parent.archivedAt === null) {
      if (page.kind !== "FreeForm") return fail(400, "Only documents can be added to a notebook");
      try {
        await addToNotebook(pageId, body.parentPageId, userId);
      } catch (err) {
        return { ok: false, response: notebookErrorResponse(err) };
      }
      return { ok: true, clearedReceivers: [], from };
    }
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== dest.type ||
      parent.workspaceId !== dest.id
    ) {
      return fail(404, "Folder not found");
    }
    if (parent.kind !== "Folder") {
      return fail(400, "Documents can only nest inside a folder");
    }
    if (!parentAccess?.canEdit) {
      return fail(403, "You can't put things in that folder");
    }
    // The moved page lands one below its new parent, and its own subtree keeps
    // going from there — so a 3-deep folder needs 3 levels of headroom, not 1.
    // Checking only the parent let a subtree settle past MAX_PAGE_DEPTH, deeper
    // than the ancestry walk in getPageAccess reaches.
    const depth = chainDepth(parentChain);
    if (depth < 0 || depth + 1 + subtree.height > MAX_PAGE_DEPTH) {
      return fail(400, "Folder is too deeply nested");
    }
    // Cycle guard: the destination can't be a descendant of the page being moved.
    if (chainHasAncestor(parentChain, pageId)) {
      return fail(400, "A document can't be moved into its own descendant");
    }
    parentPageId = body.parentPageId;
  }

  if (!sameWorkspace || parentPageId !== page.parentPageId) {
    const nameConflict = await findNameConflict({
      workspaceType: dest.type,
      workspaceId: dest.id,
      parentPageId,
      kind: page.kind,
      title: page.title,
      excludeId: pageId,
    });
    if (nameConflict) return fail(409, nameConflict);
  }

  // When a folder crosses workspaces its whole subtree comes along — not just
  // the direct children. A grandchild left on the old workspace is filtered out
  // of the new drive (wrong workspace) AND out of the old one (its parent
  // left), so it disappears from the Drive entirely.
  const movedPageIds = !sameWorkspace ? subtree.ids : [];

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

  // Without a `beforeId` the page goes after the current last sibling and
  // nobody else is renumbered; with one, the destination order is rebuilt.
  const appendPosition = appendOnly ? (lastPosition?._max.position ?? -1) + 1 : null;
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
  const destScoped = chainGoverningScope(parentChain) !== null;
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
    prisma.page.update({
      where: { id: pageId },
      data: {
        parentPageId,
        ...crossData,
        ...(appendPosition !== null ? { position: appendPosition } : {}),
      },
    }),
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
    ...(appendOnly
      ? []
      : order.map((id, index) => prisma.page.update({ where: { id }, data: { position: index } }))),
  ]);

  const [clearedReceivers] = await Promise.all([
    clearTypeIfLeavingRoot(subtreeFolderIds),
    sameWorkspace
      ? undefined
      : logAuditEvent({
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
        }),
  ]);

  return { ok: true, clearedReceivers, from };
}
