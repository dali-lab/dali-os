// GET  /api/drive/trash        — list archived items the viewer can access
// POST /api/drive/trash        — intent=archive-form: soft-archive a form
//                                intent=restore: clear archivedAt
//                                intent=purge:   permanently delete
//
// ACCESS MODEL (matches the no-widening guarantee in drive.server.ts):
//   - The viewer must be an authenticated lab member.
//   - Pages (doc/folder): viewer must have at least View access (getPageAccess).
//   - Files:              Core or project-member (canViewFile).
//   - Forms:              View on the form's page, like a doc.
//
// Restore/purge require the same level of access as deletion (edit access for
// pages and forms; file owner/core for files).

import { deleteForm, setFormArchived } from "~/forms/lib/form-page.server";
import type { Route } from "./+types/api.drive.trash";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { DRIVE_PAGE_KINDS } from "~/lib/drive.server";
import { isRoot, ROOT_DELETE_ERROR } from "~/lib/drive-roots";
import { canManageFormPlacement } from "~/forms/lib/form-access.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { CURSOR_DONE, decodeCursor, encodeCursor, joinPairCursor, keysetAfter, splitPairCursor, type KeysetCursor } from "~/lib/pagination";

export const TRASH_PAGE_SIZE = 50;
export const TRASH_BATCH_SIZE = 200;
export const TRASH_MAX_BATCHES = 10;

export function parseTrashCursor(raw: string | null): { pages: string | null; files: string | null } {
  const [pages, files] = splitPairCursor(raw);
  return { pages, files };
}

// Access is checked in JS, so a page of results is built by scanning batches
// and keeping what the viewer may see. When the scan cap is hit first, the
// cursor comes from the last row scanned so paging continues past long runs
// of rows the viewer cannot see.
async function scanVisible<T extends { id: string; archivedAt: Date | null }>(
  startCursor: string | null,
  fetchBatch: (cursor: KeysetCursor | null) => Promise<T[]>,
  filterVisible: (rows: T[]) => Promise<T[]>,
): Promise<{ items: T[]; nextCursor: string | null }> {
  if (startCursor === CURSOR_DONE) return { items: [], nextCursor: null };
  let cursor = decodeCursor(startCursor);
  const visible: T[] = [];
  let lastScanned: T | undefined;
  let exhausted = false;
  for (let i = 0; i < TRASH_MAX_BATCHES && visible.length < TRASH_PAGE_SIZE; i++) {
    const rows = await fetchBatch(cursor);
    exhausted = rows.length < TRASH_BATCH_SIZE;
    if (rows.length > 0) {
      visible.push(...(await filterVisible(rows)));
      lastScanned = rows[rows.length - 1];
      cursor = { at: lastScanned.archivedAt!.toISOString(), id: lastScanned.id };
    }
    if (exhausted) break;
  }
  const items = visible.slice(0, TRASH_PAGE_SIZE);
  const last = items[items.length - 1];
  if (visible.length > TRASH_PAGE_SIZE && last) {
    return { items, nextCursor: encodeCursor({ at: last.archivedAt!.toISOString(), id: last.id }) };
  }
  if (exhausted || !lastScanned) return { items, nextCursor: null };
  return { items, nextCursor: encodeCursor({ at: lastScanned.archivedAt!.toISOString(), id: lastScanned.id }) };
}

async function pageTitle(id: string): Promise<string | null> {
  const page = await prisma.page.findUnique({ where: { id }, select: { title: true } });
  return page?.title ?? null;
}

// ── GET: list archived items ───────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const cursors = parseTrashCursor(new URL(request.url).searchParams.get("cursor"));

  // Whiteboards belong with the other pages: the Drive deletes one through the
  // same archive path as a doc, so leaving it out meant a trashed whiteboard
  // could never be found or restored.
  const pageScan = await scanVisible(
    cursors.pages,
    (cursor) =>
      prisma.page.findMany({
        where: {
          AND: [
            { archivedAt: { not: null }, kind: { in: DRIVE_PAGE_KINDS } },
            keysetAfter("archivedAt", cursor),
          ],
        },
        // The full access shape, not just what the listing renders: the bulk
        // resolver reads these off the row instead of re-fetching each page.
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
        orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
        take: TRASH_BATCH_SIZE,
      }),
    async (rows) => {
      // includeArchived: every page here is archived by definition, so the
      // default deny would empty the whole listing.
      const access = await getPageAccessBulk(userId, rows, request, { includeArchived: true });
      return rows.filter((p) => access.get(p.id)?.canView);
    },
  );
  const accessiblePages = pageScan.items;

  // Restore/delete requires edit, not just view. canEditFile is memoized per
  // folderPageId: a folder pins a file to one project/workspace, so every file
  // sharing it gets the same answer.
  const folderAccessCache = new Map<string, Promise<boolean>>();
  const fileScan = await scanVisible(
    cursors.files,
    (cursor) =>
      prisma.projectFile.findMany({
        where: { AND: [{ archivedAt: { not: null } }, keysetAfter("archivedAt", cursor)] },
        select: { id: true, title: true, archivedAt: true, projectId: true, workspaceType: true, workspaceId: true, folderPageId: true },
        orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
        take: TRASH_BATCH_SIZE,
      }),
    async (rows) => {
      const allowed = await Promise.all(
        rows.map((f) => {
          if (!f.folderPageId) return canEditFile(userId, f, request);
          let access = folderAccessCache.get(f.folderPageId);
          if (!access) {
            access = canEditFile(userId, f, request);
            folderAccessCache.set(f.folderPageId, access);
          }
          return access;
        }),
      );
      return rows.filter((_, i) => allowed[i]);
    },
  );
  const accessibleFiles = fileScan.items;

  const items = [
    ...accessiblePages.map((p) => ({
      id: p.id,
      type: p.kind === "Folder" ? ("folder" as const) : p.kind === "Form" ? ("form" as const) : ("doc" as const),
      title: p.title ?? "",
      parentFolderId: p.parentPageId,
      archivedAt: p.archivedAt!.toISOString(),
    })),
    ...accessibleFiles.map((f) => ({
      id: f.id,
      type: "file" as const,
      title: f.title,
      parentFolderId: f.folderPageId,
      archivedAt: f.archivedAt!.toISOString(),
    })),
  ].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt) || b.id.localeCompare(a.id));

  return withCors(
    request,
    Response.json({ items, nextCursor: joinPairCursor(pageScan.nextCursor, fileScan.nextCursor) }),
  );
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
    if (!(await canManageFormPlacement(userId, id, request))) {
      return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
    }
    const form = await prisma.form.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
    if (!form) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
    if (form.archivedAt !== null) {
      // Already archived — idempotent.
      return withCors(request, Response.json({ ok: true }));
    }
    await setFormArchived(id, new Date());
    await logAuditEvent({
      action: "drive.trash.archive-form",
      userId,
      targetId: id,
      metadata: { type: "form", title: await pageTitle(id) },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  // ── restore ───────────────────────────────────────────────────────────────
  if (intent === "restore") {
    if (!type) return withCors(request, Response.json({ error: "Missing type" }, { status: 400 }));
    let title: string | null = null;

    if (type === "form") {
      if (!(await canManageFormPlacement(userId, id, request))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await setFormArchived(id, null);
      title = await pageTitle(id);
    } else if (type === "file") {
      const file = await prisma.projectFile.findUnique({
        where: { id },
        select: { projectId: true, workspaceType: true, workspaceId: true, folderPageId: true, title: true },
      });
      if (!file) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
      const ok = await canEditFile(userId, file, request);
      if (!ok) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await prisma.projectFile.update({ where: { id }, data: { archivedAt: null } });
      title = file.title;
    } else if (type === "doc" || type === "folder") {
      const access = await getPageAccess(userId, id, request, { includeArchived: true });
      if (!access.canEdit) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      const trashed = await prisma.page.findUnique({ where: { id }, select: { kind: true, archivedAt: true, title: true } });
      title = trashed?.title ?? null;
      await prisma.page.update({ where: { id }, data: { archivedAt: null } });
      // A notebook was archived together with its tabs at one instant; bring
      // back exactly those, not tabs that were trashed on their own earlier.
      if (trashed?.kind === "Notebook" && trashed.archivedAt) {
        await prisma.page.updateMany({
          where: { parentPageId: id, archivedAt: trashed.archivedAt },
          data: { archivedAt: null },
        });
      }
    } else {
      return withCors(request, Response.json({ error: "Unknown type" }, { status: 400 }));
    }
    await logAuditEvent({
      action: "drive.trash.restore",
      userId,
      targetId: id,
      metadata: { type, title },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  // ── purge: permanent delete ────────────────────────────────────────────────
  if (intent === "purge") {
    if (!type) return withCors(request, Response.json({ error: "Missing type" }, { status: 400 }));
    let title: string | null = null;

    if (type === "form") {
      if (!(await canManageFormPlacement(userId, id, request))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
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
      title = await pageTitle(id);
      await deleteForm(id);
    } else if (type === "file") {
      const file = await prisma.projectFile.findUnique({
        where: { id },
        select: { projectId: true, workspaceType: true, workspaceId: true, folderPageId: true, title: true },
      });
      if (!file) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
      const ok = await canEditFile(userId, file, request);
      if (!ok) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await prisma.projectFile.delete({ where: { id } });
      title = file.title;
    } else if (type === "doc" || type === "folder") {
      // includeArchived, same as restore: everything in Trash is archived by
      // definition, so without it getPageAccess denies every caller and purge
      // could never succeed for a doc or a folder.
      const access = await getPageAccess(userId, id, request, { includeArchived: true });
      if (!access.canEdit) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      const target = await prisma.page.findUnique({ where: { id }, select: { folderType: true, title: true } });
      title = target?.title ?? null;
      if (target && isRoot(target)) {
        return withCors(request, Response.json({ error: ROOT_DELETE_ERROR }, { status: 400 }));
      }
      // A folder's children carry an onDelete: SetNull parent link, so a hard
      // delete would silently re-home everything inside it to the drive root.
      // Purge the contents first, or move them out.
      const [childPages, childFiles] = await Promise.all([
        prisma.page.count({ where: { parentPageId: id } }),
        prisma.projectFile.count({ where: { folderPageId: id } }),
      ]);
      const held = childPages + childFiles;
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
    await logAuditEvent({
      action: "drive.trash.purge",
      userId,
      targetId: id,
      metadata: { type, title },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Unknown intent" }, { status: 400 }));
}
