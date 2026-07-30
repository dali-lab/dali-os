import type { Route } from "./+types/api.projects.$id.project-links";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

// POST /api/projects/:id/project-links — manage the project's partner-facing
// links (demo / prototype / live URLs shown in the partner portal).
// Body: { op: "create", label, url } | { op: "delete", linkId }.
// Team-editable (same gate as the other project APIs): the team curates what
// its partner sees.

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const projectId = params.id!;
  const gate = await requireProjectEditAccess(request, projectId);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.op === "create") {
    const label = typeof b.label === "string" ? b.label.trim() : "";
    let url = typeof b.url === "string" ? b.url.trim() : "";
    if (!label || !url) {
      return withCors(
        request,
        Response.json({ error: "Label and URL are required" }, { status: 400 }),
      );
    }
    // Default to https:// so a bare "example.com" still resolves off-site.
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const max = await prisma.projectLink.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    const link = await prisma.projectLink.create({
      data: {
        projectId,
        label,
        url,
        position: (max._max.position ?? -1) + 1,
        createdById: gate.auth.user.sub,
      },
      select: { id: true },
    });
    await logAuditEvent({
      action: "projectLink.create",
      userId: gate.auth.user.sub,
      targetId: link.id,
      metadata: { projectId, label, url },
      request,
    });
    return withCors(request, Response.json({ ok: true, id: link.id }));
  }

  if (b.op === "delete") {
    const linkId = typeof b.linkId === "string" ? b.linkId : "";
    if (!linkId) {
      return withCors(request, Response.json({ error: "linkId required" }, { status: 400 }));
    }
    // Scope the delete to this project so a link id can't be removed cross-project.
    const result = await prisma.projectLink.deleteMany({
      where: { id: linkId, projectId },
    });
    if (result.count === 0) {
      return withCors(request, Response.json({ error: "Link not found" }, { status: 404 }));
    }
    await logAuditEvent({
      action: "projectLink.delete",
      userId: gate.auth.user.sub,
      targetId: linkId,
      metadata: { projectId },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Invalid op" }, { status: 400 }));
}
