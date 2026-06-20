import type { Route } from "./+types/api.sessions.$id.attendance";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { bulkSetAttendance } from "~/education/lib/attendance-data";
import { logAuditEvent } from "~/lib/audit";

const VALID = new Set(["Present", "Absent", "Excused"]);

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST" && request.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const session = await prisma.educationSession.findUnique({
    where: { id: params.id },
    select: { id: true, offeringId: true },
  });
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  if (!(await canManageOffering(auth.user.sub, session.offeringId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rows)) {
    return Response.json({ error: "rows array required" }, { status: 400 });
  }

  const cleaned: { applicationId: string; status: "Present" | "Absent" | "Excused" }[] = [];
  for (const row of body.rows) {
    if (!row || typeof row !== "object") continue;
    const { applicationId, status } = row as { applicationId?: unknown; status?: unknown };
    if (typeof applicationId !== "string" || typeof status !== "string") continue;
    if (!VALID.has(status)) continue;
    cleaned.push({ applicationId, status: status as "Present" | "Absent" | "Excused" });
  }

  await bulkSetAttendance(params.id, cleaned);
  await logAuditEvent({
    action: "education.attendance.update",
    userId: auth.user.sub,
    targetId: params.id,
    metadata: { offeringId: session.offeringId, count: cleaned.length },
    request,
  });

  return Response.json({ updated: cleaned.length });
}
