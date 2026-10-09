// GET  /api/drive/trash        — list archived items the viewer can access
// POST /api/drive/trash        — intent=archive-form: soft-archive a form
//                                intent=restore: clear archivedAt
//                                intent=purge:   permanently delete
//
// ACCESS MODEL (matches the no-widening guarantee in drive.server.ts):
//   - The viewer must be an authenticated lab member.
//   - Pages (doc/folder): viewer must have at least View access (getPageAccess).
//   - Files:              Core or project-member (canViewFile).
//   - Forms:              canViewForms gate (Core/Admin/Instructor).
//
// Restore/purge require the same level of access as deletion (edit access for
// pages; canViewForms for forms; file owner/core for files).

import type { Route } from "./+types/api.drive.trash";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canViewForms as checkCanViewForms } from "~/lib/roles";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { withCors, handlePreflight } from "~/lib/cors";

// How many archived rows of each kind to look at before filtering, and how
// many of the survivors to return. Trash is a recovery surface — you come here
// for something you deleted recently — so it reads the newest rows rather than
// scanning every archived row in the database and access-checking each one.
const SCAN_LIMIT = 500;
const PER_TYPE_LIMIT = 100;

// ── GET: list archived items ───────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const userCanViewForms = await checkCanViewForms(userId, request);

  // Archived pages (docs, folders, whiteboards) — filtered through access
  // checks. Whiteboard belongs here with the rest: the Drive deletes one
  // through the same archive path as a doc, so leaving it out of this query
  // meant a trashed whiteboard could never be found or restored.
  //
  // Bounded: Trash is a recovery surface, not an archive browser, and every
  // row costs an access check. Taking the newest PAGE_SCAN keeps the cost flat
  // as the lab accumulates deleted items; the viewer's own share of them is
  // then trimmed to PER_TYPE_LIMIT below.
  const archivedPages = await prisma.page.findMany({
    where: {
      archivedAt: { not: null },
      kind: { in: ["FreeForm", "Folder", "Structured", "Whiteboard"] },
    },
    // The full access shape, not just what the listing renders: the bulk
    // resolver reads these off the row instead of re-fetching each page, and a
    // partial row would quietly compute the wrong answer.
    select: {
      id: true,
      title: true,
      archivedAt: true,
      kind: true,
      workspaceType: true,
      workspaceId: true,
      parentPageId: true,
      createdById: true,
      partnerVisible: true,
      profileVisible: true,
      labListing: true,
      linkAccess: true,
      linkPermission: true,
      scopeKind: true,
      scopeGroupId: true,
      scopePermission: true,
    },
    orderBy: { archivedAt: "desc" },
    take: SCAN_LIMIT,
  });

  // One batched access resolution instead of N sequential getPageAccess calls.
  // includeArchived: every page here is archived by definition, so the default
  // deny would empty the whole listing.
  const pageAccess = await getPageAccessBulk(userId, archivedPages, request, {
    includeArchived: true,
  });
  const accessiblePages = archivedPages
    .filter((p) => pageAccess.get(p.id)?.canView)
    .slice(0, PER_TYPE_LIMIT);

  // Archived files the viewer can edit (restore/delete requires edit, not just view).
  const archivedFiles = await prisma.projectFile.findMany({
    where: { archivedAt: { not: null } },
    select: { id: true, title: true, archivedAt: true, projectId: true, workspaceType: true, workspaceId: true, folderPageId: true },
    orderBy: { archivedAt: "desc" },
    take: SCAN_LIMIT,
  });

  // Memoize canEditFile per distinct folderPageId: a folderPageId pins a file
  // to one project/workspace, so every file sharing it gets the same
  // ancestor-walk answer — compute it once instead of once per file. Mirrors
  // the folderAccess memo pattern in drive.server.ts (loadLabFiles/loadFiles).
  const folderAccessCache = new Map<string, Promise<boolean>>();
  const fileAccess = await Promise.all(
    archivedFiles.map((f) => {
      if (!f.folderPageId) return canEditFile(userId, f, request);
      let access = folderAccessCache.get(f.folderPageId);
      if (!access) {
        access = canEditFile(userId, f, request);
        folderAccessCache.set(f.folderPageId, access);
      }
      return access;
    }),
  );
  const accessibleFiles = archivedFiles
    .filter((_, i) => fileAccess[i])
    .slice(0, PER_TYPE_LIMIT);

  // Archived forms — canViewForms gate is sufficient (organisation-only placement).
  const archivedForms = userCanViewForms
    ? await prisma.form.findMany({
        where: { archivedAt: { not: null } },
        select: { id: true, name: true, archivedAt: true },
        orderBy: { archivedAt: "desc" },
        take: PER_TYPE_LIMIT,
      })
    : [];

  const items = [
    ...accessiblePages.map((p) => ({
      id: p.id,
      type: p.kind === "Folder" ? ("folder" as const) : ("doc" as const),
      title: p.title ?? "",
      archivedAt: p.archivedAt!.toISOString(),
    })),
    ...accessibleFiles.map((f) => ({
      id: f.id,
      type: "file" as const,
      title: f.title,
      archivedAt: f.archivedAt!.toISOString(),
    })),
    ...archivedForms.map((f) => ({
      id: f.id,
      type: "form" as const,
      title: f.name,
      archivedAt: f.archivedAt!.toISOString(),
    })),
  ].sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());

  return withCors(request, Response.json({ items }));
}

// ── POST: archive-form / restore / purge ──────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const fd = await request.formData();
  const intent = fd.get("intent") as string;
  const type = fd.get("type") as string;
  const id = fd.get("id") as string;

  if (!intent || !id) {
    return withCors(request, Response.json({ error: "Missing intent or id" }, { status: 400 }));
  }

  // ── archive-form: soft-delete a form from Drive ────────────────────────────
  if (intent === "archive-form") {
    const userCanViewForms = await checkCanViewForms(userId, request);
    if (!userCanViewForms) {
      return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
    }
    const form = await prisma.form.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
    if (!form) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
    if (form.archivedAt !== null) {
      // Already archived — idempotent.
      return withCors(request, Response.json({ ok: true }));
    }
    await prisma.form.update({ where: { id }, data: { archivedAt: new Date() } });
    return withCors(request, Response.json({ ok: true }));
  }

  // ── restore ───────────────────────────────────────────────────────────────
  if (intent === "restore") {
    if (!type) return withCors(request, Response.json({ error: "Missing type" }, { status: 400 }));

    if (type === "form") {
      const userCanViewForms = await checkCanViewForms(userId, request);
      if (!userCanViewForms) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await prisma.form.update({ where: { id }, data: { archivedAt: null } });
    } else if (type === "file") {
      const file = await prisma.projectFile.findUnique({
        where: { id },
        select: { projectId: true, workspaceType: true, workspaceId: true, folderPageId: true },
      });
      if (!file) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
      const ok = await canEditFile(userId, file, request);
      if (!ok) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await prisma.projectFile.update({ where: { id }, data: { archivedAt: null } });
    } else if (type === "doc" || type === "folder") {
      const access = await getPageAccess(userId, id, request, { includeArchived: true });
      if (!access.canEdit) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await prisma.page.update({ where: { id }, data: { archivedAt: null } });
    } else {
      return withCors(request, Response.json({ error: "Unknown type" }, { status: 400 }));
    }
    return withCors(request, Response.json({ ok: true }));
  }

  // ── purge: permanent delete ────────────────────────────────────────────────
  if (intent === "purge") {
    if (!type) return withCors(request, Response.json({ error: "Missing type" }, { status: 400 }));

    if (type === "form") {
      const userCanViewForms = await checkCanViewForms(userId, request);
      if (!userCanViewForms) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      // Purge respects the same blocker check as the hard-delete path.
      const { formDeletionBlockers } = await import("~/forms/lib/form-usages.server");
      const blockers = await formDeletionBlockers(id);
      if (blockers.length > 0) {
        return withCors(
          request,
          Response.json(
            { error: `This form is in use: ${blockers.join("; ")}. Remove those bindings first.` },
            { status: 409 },
          ),
        );
      }
      await prisma.form.delete({ where: { id } });
    } else if (type === "file") {
      const file = await prisma.projectFile.findUnique({
        where: { id },
        select: { projectId: true, workspaceType: true, workspaceId: true, folderPageId: true },
      });
      if (!file) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
      const ok = await canEditFile(userId, file, request);
      if (!ok) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await prisma.projectFile.delete({ where: { id } });
    } else if (type === "doc" || type === "folder") {
      // includeArchived, same as restore: everything in Trash is archived by
      // definition, so without it getPageAccess denies every caller and purge
      // could never succeed for a doc or a folder.
      const access = await getPageAccess(userId, id, request, { includeArchived: true });
      if (!access.canEdit) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      // A folder's children carry an onDelete: SetNull parent link, so a hard
      // delete would silently re-home everything inside it to the drive root.
      // Purge the contents first, or move them out.
      const [childPages, childFiles, childForms] = await Promise.all([
        prisma.page.count({ where: { parentPageId: id } }),
        prisma.projectFile.count({ where: { folderPageId: id } }),
        prisma.form.count({ where: { folderPageId: id } }),
      ]);
      const held = childPages + childFiles + childForms;
      if (held > 0) {
        return withCors(
          request,
          Response.json(
            { error: `This folder still holds ${held} ${held === 1 ? "item" : "items"}. Delete those first.` },
            { status: 409 },
          ),
        );
      }
      await prisma.page.delete({ where: { id } });
    } else {
      return withCors(request, Response.json({ error: "Unknown type" }, { status: 400 }));
    }
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Unknown intent" }, { status: 400 }));
}
