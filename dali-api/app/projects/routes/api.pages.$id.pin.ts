import type { Route } from "./+types/api.pages.$id.pin";
import type { AuthSuccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess, requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

// POST /api/pages/:id/pin — pin/unpin a page (document or folder) to the top
// of its Documents view. Body: { pinned: boolean }. Project pages use the
// project-edit gate; Lab pages (the lab-wide Documents area) use the
// lab-member gate. pinnedAt is a single flag on the Page, so pinning a project
// doc here and in the project hub are the same pin.

type Body = { pinned: boolean };

function isBody(x: unknown): x is Body {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as Record<string, unknown>).pinned === "boolean"
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const pageId = params.id!;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, workspaceType: true, workspaceId: true, archivedAt: true },
  });
  if (
    !page ||
    (page.workspaceType !== "Project" && page.workspaceType !== "Lab") ||
    (page.workspaceType === "Project" && !page.workspaceId) ||
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  await prisma.page.update({
    where: { id: pageId },
    data: { pinnedAt: body.pinned ? new Date() : null },
  });
  await logAuditEvent({
    action: "page.pin",
    userId: auth.user.sub,
    targetId: pageId,
    metadata: { workspaceType: page.workspaceType, projectId: page.workspaceId, pinned: body.pinned },
    request,
  });
  return withCors(request, Response.json({ ok: true }));
}
