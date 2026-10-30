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
import { attachMeetingNote } from "~/lib/scheduled-meeting";
import { actionItemsOf, notePageId } from "~/lib/mobile-notes";
import { decodeCursor, encodeCursor, keysetAfter, keysetPage } from "~/lib/pagination";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

export const MAX_NOTES = 30;

const DONE = "done";

// Recordings and typed notes are two lists, so one cursor string carries a
// position for each: "<recordings>~<pages>", each "start", "done" or "<at>|<id>".
export function parseNotesCursor(raw: string | null): { recordings: string | null; pages: string | null } {
  const [recordings = "start", pages = "start"] = (raw ?? "").split("~");
  const part = (v: string) => (v === "start" || v === "" ? null : v);
  return { recordings: part(recordings), pages: part(pages) };
}

function formatNotesCursor(recordings: string | null, pages: string | null): string | null {
  if (recordings === null && pages === null) return null;
  return `${recordings ?? DONE}~${pages ?? DONE}`;
}

function after(field: "createdAt" | "updatedAt", position: string | null) {
  const cursor = decodeCursor(position);
  return cursor ? { AND: [keysetAfter(field, cursor)] } : {};
}

const NewNoteSchema = z.union([
  z.object({ title: z.string().trim().min(1).max(200) }),
  z.object({ scheduledMeetingId: z.string().min(1), occurrenceStart: z.string().datetime() }),
]);

async function canRecord(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return isTranscriptionEnabled() && (await isFeatureEnabled("ai-meeting-notes", userId, roles, request));
}

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;

  const cursors = parseNotesCursor(new URL(request.url).searchParams.get("cursor"));

  const [recordingEnabled, recordingRows, typedRows] = await Promise.all([
    canRecord(userId, request),
    cursors.recordings === DONE
      ? []
      : prisma.meetingRecording.findMany({
        where: { userId, ...after("createdAt", cursors.recordings) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_NOTES + 1,
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
    // Typed notes: pages the member started in their own space or in a notebook.
    cursors.pages === DONE
      ? []
      : prisma.page.findMany({
        where: {
          createdById: userId,
          kind: "FreeForm",
          archivedAt: null,
          OR: [{ workspaceType: "Member", workspaceId: userId }, { parent: { kind: "Notebook" } }],
          ...after("updatedAt", cursors.pages),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: MAX_NOTES + 1,
        select: { id: true, title: true, updatedAt: true, parent: { select: { kind: true, title: true } } },
      }),
  ]);

  const recordingPage = keysetPage(recordingRows, MAX_NOTES, (r) => ({ at: r.createdAt.toISOString(), id: r.id }));
  const typedPage = keysetPage(typedRows, MAX_NOTES, (p) => ({ at: p.updatedAt.toISOString(), id: p.id }));
  const rows = recordingPage.items;
  const typed = typedPage.items;

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
    // A page a recording already covers shows once, as that recording.
    pages: typed
      .filter((p) => !pageIds.includes(p.id))
      .map((p) => ({
        id: p.id,
        title: p.title,
        updatedAt: p.updatedAt.toISOString(),
        notebook: p.parent?.kind === "Notebook" ? p.parent.title : null,
      })),
    nextCursor: formatNotesCursor(recordingPage.nextCursor, typedPage.nextCursor),
  });
}

// A page to take notes in (and maybe record into): a new personal note, or the
// calendar meeting occurrence's notes page (created on first use, filed the way
// the web calendar files it). Notebook notes go through POST /api/notebooks/:id.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const body = await parseJson(request, NewNoteSchema);
  if (body instanceof Response) return body;

  if ("scheduledMeetingId" in body) {
    const result = await attachMeetingNote({
      meetingId: body.scheduledMeetingId,
      actorId: guard.userId,
      occurrence: new Date(body.occurrenceStart),
    });
    if (!result.ok) return mobileError(result.error, result.status);
    return mobileJson({ pageId: result.notePageId, documentName: pageDocName(result.notePageId) }, { status: 201 });
  }

  try {
    const page = await createNote(guard.userId, { title: body.title });
    return mobileJson({ pageId: page.id, documentName: pageDocName(page.id) }, { status: 201 });
  } catch (err) {
    if (err instanceof PageNameConflictError) return mobileError(err.message, 409);
    throw err;
  }
}
