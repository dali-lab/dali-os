import type { Route } from "./+types/api.mobile.notes";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { isTranscriptionEnabled } from "~/lib/transcription/provider";
import { pageDocName } from "~/collab/roomName";
import { parseJson } from "~/lib/validate";
import { createNote } from "~/members/lib/personal-notes-actions.server";
import { PageNameConflictError } from "~/lib/page-names.server";
import { actionItemsOf, notePageId } from "~/lib/mobile-notes";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

const MAX_NOTES = 30;

const QuickNoteSchema = z.object({ title: z.string().trim().min(1).max(200) });

async function canRecord(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return isTranscriptionEnabled() && (await isFeatureEnabled("ai-meeting-notes", userId, roles, request));
}

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;

  const [recordingEnabled, rows] = await Promise.all([
    canRecord(userId, request),
    prisma.meetingRecording.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: MAX_NOTES,
      select: {
        id: true,
        documentName: true,
        status: true,
        createdAt: true,
        recordedSeconds: true,
        scheduledMeetingId: true,
        occurrenceStart: true,
        enhancedAt: true,
        notes: true,
        scheduledMeeting: { select: { title: true } },
      },
    }),
  ]);

  const pageIds = [...new Set(rows.map((r) => notePageId(r.documentName)).filter((id): id is string => Boolean(id)))];
  const pages = pageIds.length
    ? await prisma.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, title: true } })
    : [];
  const titleOf = new Map(pages.map((p) => [p.id, p.title]));

  return mobileJson({
    recordingEnabled,
    notes: rows.map((r) => {
      const items = actionItemsOf(r.notes);
      const pageId = notePageId(r.documentName);
      return {
        id: r.id,
        title: r.scheduledMeeting?.title ?? (pageId ? titleOf.get(pageId) : null) ?? "Untitled",
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        recordedSeconds: r.recordedSeconds,
        scheduledMeetingId: r.scheduledMeetingId,
        occurrenceStart: r.occurrenceStart?.toISOString() ?? null,
        enhancedAt: r.enhancedAt?.toISOString() ?? null,
        actionItemCount: items.length,
        tasksCreated: items.filter((a) => a.taskId).length,
      };
    }),
  });
}

// A recording that isn't for a calendar meeting still needs a page for its
// notes; it gets a new personal note, the same place a web quick note lands.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  if (!(await canRecord(guard.userId, request))) return mobileError("Not available", 403);
  const body = await parseJson(request, QuickNoteSchema);
  if (body instanceof Response) return body;
  try {
    const page = await createNote(guard.userId, { title: body.title });
    return mobileJson({ documentName: pageDocName(page.id) }, { status: 201 });
  } catch (err) {
    if (err instanceof PageNameConflictError) return mobileError(err.message, 409);
    throw err;
  }
}
