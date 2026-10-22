import type { Route } from "./+types/api.mobile.notes.$id";
import { prisma } from "~/lib/db";
import { readDocAsBlocks } from "~/collab/read";
import { resolveMeetingOccurrence } from "~/lib/scheduled-meeting";
import { canReadRecording, canRecordInto, resolveSpeakerNames, storedLines } from "~/lib/meeting-recording.server";
import { actionItemsOf, noteOutline, notePageId } from "~/lib/mobile-notes";
import { McpError } from "~/mcp/errors";
import { runEnhanceMeetingNotes } from "~/mcp/tools/calendar-extra/enhance-meeting-notes";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

async function meetingFor(scheduledMeetingId: string, occurrenceStart: Date | null, userId: string) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: scheduledMeetingId },
    select: {
      id: true,
      title: true,
      selectedAt: true,
      createdAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      externalEventId: true,
    },
  });
  if (!meeting?.selectedAt) return null;
  const occ = await resolveMeetingOccurrence(meeting, occurrenceStart);
  const entry = await prisma.timeEntry.findUnique({
    where: {
      scheduledMeetingId_occurrenceStart_userId: {
        scheduledMeetingId: meeting.id,
        occurrenceStart: occ.originalStart,
        userId,
      },
    },
    select: { id: true, hours: true, roleRefId: true },
  });
  return {
    id: meeting.id,
    title: meeting.title,
    start: occ.start.toISOString(),
    end: occ.end.toISOString(),
    occurrenceStart: occ.originalStart.toISOString(),
    timeEntry: entry,
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;

  const rec = await prisma.meetingRecording.findUnique({ where: { id: params.id } });
  if (!rec || !(await canReadRecording(rec, userId))) return mobileError("Not found", 404);

  const pageId = notePageId(rec.documentName);
  const [page, canEdit, speakerNames, blocks, meeting] = await Promise.all([
    pageId
      ? prisma.page.findUnique({ where: { id: pageId }, select: { title: true, workspaceType: true, workspaceId: true } })
      : null,
    canRecordInto(userId, rec.documentName),
    resolveSpeakerNames((rec.speakers as Record<string, string> | null) ?? {}),
    rec.status === "Done" ? readDocAsBlocks(rec.documentName) : Promise.resolve([]),
    rec.scheduledMeetingId ? meetingFor(rec.scheduledMeetingId, rec.occurrenceStart, userId) : null,
  ]);
  const projectId = page?.workspaceType === "Project" ? page.workspaceId : null;
  const project = projectId
    ? await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } })
    : null;

  return mobileJson({
    id: rec.id,
    title: meeting?.title ?? page?.title ?? "Untitled",
    status: rec.status,
    error: rec.status === "Failed" ? rec.error : null,
    createdAt: rec.createdAt.toISOString(),
    recordedSeconds: rec.recordedSeconds,
    isOwner: rec.userId === userId,
    canEdit,
    enhancedAt: rec.enhancedAt?.toISOString() ?? null,
    pagePath: pageId ? `/documents/${pageId}` : null,
    project,
    meeting,
    outline: noteOutline(blocks),
    actionItems: actionItemsOf(rec.notes),
    speakerNames,
    lines: storedLines(rec).map((l) => ({ at: l.at, end: l.end ?? l.at, text: l.text, speaker: l.speaker ?? null })),
  });
}

// POST { action: "enhance" }: writes the AI notes into the meeting's page,
// the same preview-then-apply pass the web note's Enhance button runs.
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "enhance") return mobileError("Unknown action", 400);

  const user = await prisma.user.findUnique({
    where: { id: guard.userId },
    select: { daliEmail: true, dartmouthEmail: true, netId: true, firstName: true, lastName: true },
  });
  if (!user) return mobileError("Not found", 404);
  const ctx = {
    user: { id: guard.userId, ...user, firstName: user.firstName ?? "", lastName: user.lastName ?? "" },
    scopes: [],
    request,
  };
  try {
    await runEnhanceMeetingNotes(ctx, { recordingId: params.id });
    await runEnhanceMeetingNotes(ctx, { recordingId: params.id, apply: true });
  } catch (err) {
    if (err instanceof McpError) return mobileError(err.message, err.status);
    throw err;
  }
  return mobileJson({ ok: true });
}
