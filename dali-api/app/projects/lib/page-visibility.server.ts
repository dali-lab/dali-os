import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent, type AuditAction } from "~/lib/audit";
import { notifyPartnerDocumentShared } from "~/partners/lib/partner-notify.server";

// Shared body of the two page-sharing toggles: /api/pages/:id/partner-visible
// and /api/pages/:id/public-visible. The audiences are orthogonal (a partner
// working doc isn't public; the public write-up isn't the partner's), but the
// mechanics — find the project page, gate on project edit access, flip one
// boolean, audit it — are identical, so they live here once.

export type PageVisibilityField = "partnerVisible" | "publicVisible";

const AUDIT_ACTION: Record<PageVisibilityField, AuditAction> = {
  partnerVisible: "page.partner-visibility",
  publicVisible: "page.public-visibility",
};

export async function handlePageVisibility(
  request: Request,
  pageId: string,
  field: PageVisibilityField,
): Promise<Response> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      partnerVisible: true,
    },
  });
  if (
    !page ||
    page.workspaceType !== "Project" ||
    !page.workspaceId ||
    page.archivedAt !== null
  ) {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, page.workspaceId);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "boolean") {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  await prisma.page.update({ where: { id: pageId }, data: { [field]: value } });
  await logAuditEvent({
    action: AUDIT_ACTION[field],
    userId: gate.auth.user.sub,
    targetId: pageId,
    metadata: { projectId: page.workspaceId, [field]: value },
    request,
  });
  // Newly shared with partners → notify them (best-effort). Only the
  // false→true partnerVisible transition; re-sharing an already-shared page or
  // toggling public visibility sends nothing.
  if (field === "partnerVisible" && value && !page.partnerVisible) {
    await notifyPartnerDocumentShared({
      projectId: page.workspaceId,
      docTitle: page.title || "a document",
      href: `/partner/projects/${page.workspaceId}/pages/${pageId}`,
    });
  }
  return withCors(request, Response.json({ ok: true }));
}
