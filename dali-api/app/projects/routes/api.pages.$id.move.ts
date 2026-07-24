import type { Route } from "./+types/api.pages.$id.move";
import type { AuthSuccess } from "~/lib/auth";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireMemberSession, requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

// POST /api/pages/:id/move — move and/or reorder a document within its
// Documents view. Body: { parentPageId: string | null, beforeId?: string | null }.
//   - parentPageId: the folder to nest under, or null for the top level.
//   - beforeId: the sibling to drop directly before; omitted/null appends last.
// Works for both Lab pages (the lab-wide Documents hub — any lab member) and
// Project pages (the project hub — project editors). Folders stay top-level
// (they may be reordered but never nested). Enforces the 2-level cap: a
// document only nests directly under a top-level Folder in the same workspace.

const BodySchema = z.object({
  parentPageId: z.string().min(1).nullable(),
  beforeId: z.string().min(1).nullable().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const pageId = params.id!;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, workspaceType: true, workspaceId: true, kind: true, archivedAt: true },
  });
  if (
    !page ||
    (page.workspaceType !== "Lab" && page.workspaceType !== "Project") ||
    (page.workspaceType === "Lab" ? page.workspaceId !== null : !page.workspaceId) ||
    page.archivedAt !== null
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
  void auth;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  if (body.parentPageId === pageId) {
    return withCors(request, Response.json({ error: "A document can't be moved into itself" }, { status: 400 }));
  }
  if (page.kind === "Folder" && body.parentPageId !== null) {
    return withCors(request, Response.json({ error: "Folders can't be nested inside another folder" }, { status: 400 }));
  }

  let parentPageId: string | null = null;
  if (body.parentPageId) {
    const parent = await prisma.page.findUnique({
      where: { id: body.parentPageId },
      select: { workspaceType: true, workspaceId: true, parentPageId: true, kind: true, archivedAt: true },
    });
    if (
      !parent ||
      parent.archivedAt !== null ||
      parent.workspaceType !== page.workspaceType ||
      parent.workspaceId !== page.workspaceId
    ) {
      return withCors(request, Response.json({ error: "Folder not found" }, { status: 404 }));
    }
    if (parent.kind !== "Folder" || parent.parentPageId !== null) {
      return withCors(request, Response.json({ error: "Documents can only nest inside a top-level folder" }, { status: 400 }));
    }
    parentPageId = body.parentPageId;
  }

  // Rebuild the destination sibling order with the moved page inserted before
  // `beforeId` (or appended), then rewrite positions 0..n so the order is
  // stable. Done in a transaction so a concurrent move can't interleave.
  const siblings = await prisma.page.findMany({
    where: {
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      parentPageId,
      archivedAt: null,
    },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const order = siblings.map((s) => s.id).filter((id) => id !== pageId);
  const beforeIndex = body.beforeId ? order.indexOf(body.beforeId) : -1;
  if (beforeIndex >= 0) order.splice(beforeIndex, 0, pageId);
  else order.push(pageId);

  await prisma.$transaction([
    prisma.page.update({ where: { id: pageId }, data: { parentPageId } }),
    ...order.map((id, index) =>
      prisma.page.update({ where: { id }, data: { position: index } }),
    ),
  ]);

  return withCors(request, Response.json({ ok: true }));
}
