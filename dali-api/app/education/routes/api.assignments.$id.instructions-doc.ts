import type { Route } from "./+types/api.assignments.$id.instructions-doc";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { logAuditEvent } from "~/lib/audit";

/**
 * Assigns a CollabDocument name to the assignment's `instructionsDocId`
 * (if not already set). The actual document row is created lazily by
 * Hocuspocus on first edit — we just reserve the name. Returns the doc
 * id (i.e. the value to pass to `/documents/:pageId`).
 */
export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: params.id },
    select: { id: true, offeringId: true, instructionsDocId: true },
  });
  if (!assignment?.offeringId) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await canManageOffering(auth.user.sub, assignment.offeringId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (assignment.instructionsDocId) {
    return Response.json({ docId: assignment.instructionsDocId, existed: true });
  }

  const docId = `edu:assignment:${assignment.id}`;
  await prisma.educationAssignment.update({
    where: { id: assignment.id },
    data: { instructionsDocId: docId },
  });

  await logAuditEvent({
    action: "education.assignment.instructions_doc",
    userId: auth.user.sub,
    targetId: assignment.id,
    metadata: { docId },
    request,
  });

  return Response.json({ docId, existed: false });
}
