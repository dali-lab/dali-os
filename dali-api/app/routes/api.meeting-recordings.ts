// POST /api/meeting-recordings — start a recording for a collaborative
// document. Creates the MeetingRecording row and returns the dalios:// link
// the page hands to the desktop app (browsers record in-page instead).
// Gated on the `ai-meeting-notes` flag and on write access to the document's
// collab room (the same check the collab server applies).
//
// Also accepts `scheduledMeetingId` (+ optional `occurrenceStart`) in place
// of `documentName`: the server resolves or creates that occurrence's note
// via attachMeetingNote, honoring the project's recordingPolicy and the
// lab-wide active-recording cap.

import type { Route } from "./+types/api.meeting-recordings";
import { requireAuth } from "~/lib/auth";
import { isAiEnabled } from "~/lib/ai.server";
import { isTranscriptionEnabled } from "~/lib/transcription/provider";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { attachMeetingNote } from "~/lib/scheduled-meeting";
import { pageDocName } from "~/collab/roomName";
import {
  canRecordInto,
  createRecording,
  projectRecordingDisabled,
  recordingDeepLink,
} from "~/lib/meeting-recording.server";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let documentName = typeof body?.documentName === "string" ? body.documentName : "";
  const scheduledMeetingId =
    typeof body?.scheduledMeetingId === "string" && body.scheduledMeetingId ? body.scheduledMeetingId : undefined;
  const occurrenceStartRaw = typeof body?.occurrenceStart === "string" ? body.occurrenceStart : undefined;
  const occurrenceStart = occurrenceStartRaw ? new Date(occurrenceStartRaw) : undefined;
  if (occurrenceStartRaw && Number.isNaN(occurrenceStart?.getTime())) {
    return Response.json({ error: "Invalid occurrenceStart" }, { status: 400 });
  }

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("ai-meeting-notes", auth.user.sub, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  if (scheduledMeetingId) {
    if (await projectRecordingDisabled(scheduledMeetingId)) {
      return Response.json({ error: "recordingDisabled" }, { status: 403 });
    }
    if (!documentName) {
      const result = await attachMeetingNote({
        meetingId: scheduledMeetingId,
        actorId: auth.user.sub,
        occurrence: occurrenceStart ?? null,
      });
      if (!result.ok) {
        if (result.status === 400) return Response.json({ error: "noteRequired" }, { status: 400 });
        if (result.status === 403) return Response.json({ error: "forbidden" }, { status: 403 });
        return Response.json({ error: result.error }, { status: result.status });
      }
      documentName = pageDocName(result.notePageId);
    }
  }

  if (!documentName) return Response.json({ error: "documentName is required" }, { status: 400 });
  if (!(await canRecordInto(auth.user.sub, documentName))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const rec = await createRecording(auth.user.sub, documentName, {
    scheduledMeetingId,
    occurrenceStart: occurrenceStart ?? null,
  });
  if (!rec) {
    return Response.json(
      { error: "Recording is busy right now, try again in a few minutes." },
      { status: 503 },
    );
  }

  return Response.json(
    {
      id: rec.id,
      link: recordingDeepLink(rec.id),
      transcriptionEnabled: isTranscriptionEnabled(),
      aiEnabled: isAiEnabled(),
    },
    { status: 201 },
  );
}
