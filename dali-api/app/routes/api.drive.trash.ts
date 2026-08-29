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
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { withCors, handlePreflight } from "~/lib/cors";

// ── GET: list archived items ───────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const userCanViewForms = await checkCanViewForms(userId, request);

  // Archived pages (docs + folders) — filtered through access checks.
  const archivedPages = await prisma.page.findMany({
    where: {
      archivedAt: { not: null },
      kind: { in: ["FreeForm", "Folder", "Structured"] },
    },
    select: { id: true, title: true, archivedAt: true, kind: true },
    orderBy: { archivedAt: "desc" },
  });

  // Batch access check — include only items the viewer can at least view.
  const accessiblePages = (
    await Promise.all(
      archivedPages.map(async (p) => {
        const access = await getPageAccess(userId, p.id, request);
        return access.canView ? p : null;
      }),
    )
  ).filter(Boolean) as typeof archivedPages;

  // Archived files the viewer can edit (restore/delete requires edit, not just view).
  const archivedFiles = await prisma.projectFile.findMany({
    where: { archivedAt: { not: null } },
    select: { id: true, title: true, archivedAt: true, projectId: true, workspaceType: true, workspaceId: true, folderPageId: true },
    orderBy: { archivedAt: "desc" },
  });

  const accessibleFiles = (
    await Promise.all(
      archivedFiles.map(async (f) => {
        const ok = await canEditFile(userId, f, request);
        return ok ? f : null;
      }),
    )
  ).filter(Boolean) as typeof archivedFiles;

  // Archived forms — canViewForms gate is sufficient (organisation-only placement).
  const archivedForms = userCanViewForms
    ? await prisma.form.findMany({
        where: { archivedAt: { not: null } },
        select: { id: true, name: true, archivedAt: true },
        orderBy: { archivedAt: "desc" },
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
      const access = await getPageAccess(userId, id, request);
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
      const access = await getPageAccess(userId, id, request);
      if (!access.canEdit) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
      await prisma.page.delete({ where: { id } });
    } else {
      return withCors(request, Response.json({ error: "Unknown type" }, { status: 400 }));
    }
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Unknown intent" }, { status: 400 }));
}
