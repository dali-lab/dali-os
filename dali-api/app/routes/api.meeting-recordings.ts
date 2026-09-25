// POST /api/meeting-recordings — start a native recording for a collaborative
// document. Creates the MeetingRecording row and returns the dalios:// link the
// page opens to hand it to the desktop app. Gated on the `ai-meeting-notes`
// flag and on write access to the document's collab room (the same check the
// collab server applies). Also tells the page whether an AI provider is set,
// so it can offer notes or just the transcript.

import type { Route } from "./+types/api.meeting-recordings";
import { requireAuth } from "~/lib/auth";
import { isAiEnabled } from "~/lib/ai.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import {
  canRecordInto,
  createRecording,
  recordingDeepLink,
} from "~/lib/meeting-recording.server";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as { documentName?: unknown } | null;
  const documentName = typeof body?.documentName === "string" ? body.documentName : "";
  if (!documentName) return Response.json({ error: "documentName is required" }, { status: 400 });

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("ai-meeting-notes", auth.user.sub, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }
  if (!(await canRecordInto(auth.user.sub, documentName))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const rec = await createRecording(auth.user.sub, documentName);
  return Response.json(
    { id: rec.id, link: recordingDeepLink(rec.id), aiEnabled: isAiEnabled() },
    { status: 201 },
  );
}
