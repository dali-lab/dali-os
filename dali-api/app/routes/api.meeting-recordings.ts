// POST /api/meeting-recordings — start a native recording for a meeting-note
// document. Creates the MeetingRecording row and returns the dalios:// link the
// page opens to hand it to the desktop app. Same gate as writing the notes:
// the `ai-meeting-notes` flag and edit access to a meeting-note page.

import type { Route } from "./+types/api.meeting-recordings";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { getUserRoles } from "~/lib/roles";
import { createRecording, recordingDeepLink } from "~/lib/meeting-recording.server";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as { pageId?: unknown } | null;
  const pageId = typeof body?.pageId === "string" ? body.pageId : "";
  if (!pageId) return Response.json({ error: "pageId is required" }, { status: 400 });

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("ai-meeting-notes", auth.user.sub, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { meetingNoteId: true } });
  if (!page?.meetingNoteId) return Response.json({ error: "Not found" }, { status: 404 });
  const access = await getPageAccess(auth.user.sub, pageId, request);
  if (!access.canEdit) return Response.json({ error: "Forbidden" }, { status: 403 });

  const rec = await createRecording(auth.user.sub, pageId);
  return Response.json({ id: rec.id, link: recordingDeepLink(rec.id) }, { status: 201 });
}
