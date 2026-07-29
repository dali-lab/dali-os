import type { Route } from "./+types/api.files.$id.partner-visible";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { notifyPartnerDocumentShared } from "~/partners/lib/partner-notify.server";

// POST /api/files/:id/partner-visible — toggle a project file's partner
// sharing. Body: { partnerVisible: boolean }. Team-editable (same gate as the
// other file APIs): the team curates what its partner sees. Mirrors
// api.pages.$id.partner-visible.ts.

type Body = { partnerVisible: boolean };

function isBody(x: unknown): x is Body {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as Record<string, unknown>).partnerVisible === "boolean"
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const fileId = params.id!;
  const file = await prisma.projectFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      title: true,
      projectId: true,
      archivedAt: true,
      partnerVisible: true,
    },
  });
  if (!file || file.archivedAt !== null) {
    return withCors(request, Response.json({ error: "File not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, file.projectId);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  await prisma.projectFile.update({
    where: { id: fileId },
    data: { partnerVisible: body.partnerVisible },
  });
  await logAuditEvent({
    action: "projectFile.partner-visibility",
    userId: gate.auth.user.sub,
    targetId: fileId,
    metadata: { projectId: file.projectId, partnerVisible: body.partnerVisible },
    request,
  });
  // Newly shared with partners → notify them (best-effort). Files preview in
  // the project hub, so link there rather than to a standalone file route.
  if (body.partnerVisible && !file.partnerVisible) {
    await notifyPartnerDocumentShared({
      projectId: file.projectId,
      docTitle: file.title || "a file",
      href: `/partner/projects/${file.projectId}`,
    });
  }
  return withCors(request, Response.json({ ok: true }));
}
