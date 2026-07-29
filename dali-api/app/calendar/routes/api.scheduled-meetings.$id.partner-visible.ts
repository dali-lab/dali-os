import type { Route } from "./+types/api.scheduled-meetings.$id.partner-visible";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { sharePartnerMeeting } from "~/partners/lib/partner-meeting.server";

// POST /api/scheduled-meetings/:id/partner-visible — share (or unshare) a
// meeting with the project's partners. Body: { partnerVisible: boolean }.
// Team-editable (same gate as the project's docs/files). Mirrors
// api.files.$id.partner-visible.ts. On false→true, delivers the invite.

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
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: { id: true, projectId: true, partnerVisible: true },
  });
  if (!meeting) {
    return withCors(request, Response.json({ error: "Meeting not found" }, { status: 404 }));
  }
  // Sharing only means something on a project-scoped meeting (that's how the
  // partner audience is resolved).
  if (!meeting.projectId) {
    return withCors(
      request,
      Response.json({ error: "Attach the meeting to a project first" }, { status: 400 }),
    );
  }
  const gate = await requireProjectEditAccess(request, meeting.projectId);
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

  await prisma.scheduledMeeting.update({
    where: { id: meeting.id },
    data: { partnerVisible: body.partnerVisible },
  });
  await logAuditEvent({
    action: "meeting.partner-visibility",
    userId: gate.auth.user.sub,
    targetId: meeting.id,
    metadata: { projectId: meeting.projectId, partnerVisible: body.partnerVisible },
    request,
  });

  // Newly shared → deliver the calendar invite (best-effort).
  if (body.partnerVisible && !meeting.partnerVisible) {
    await sharePartnerMeeting(meeting.id);
  }
  return withCors(request, Response.json({ ok: true }));
}
