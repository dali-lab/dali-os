// /api/meeting-recordings/:id — one recording. Used by three audiences:
//   - The owner (page cookie session, or the desktop app's Session Bearer):
//     GET for the full state, POST actions (claim/stop/resume/speakers/
//     finish), DELETE to discard.
//   - Any other viewer of the note (authorizeCollabDoc): GET a read-only
//     view, POST {action:"speakers"} (any editor, via canRecordInto). An
//     editor (not just the owner) may also POST {action:"stop"} — someone
//     has to be able to stop a recording whose owner went silent — and the
//     final stop once the owner's device looks done uploading
//     (EDITOR_FINAL_STOP_STALE_MS).
//   - Core: DELETE even when not the owner.
// Old (pre-v2) desktop builds call {action:"append"} and get 410 — the page
// itself detects a stuck Pending row and tells the user to update.
//
// NEVER log transcript text.

import type { Route } from "./+types/api.meeting-recordings.$id";
import { z } from "zod";
import type { Prisma } from "~/generated/prisma/client";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { deletePrefix } from "~/lib/transcription/chunks.server";
import {
  canReadRecording,
  canRecordInto,
  claimRecording,
  documentTitle,
  finalizeEmpty,
  finishRecording,
  parseSpeakerMap,
  requestStop,
  resolveSpeakerNames,
  resumeRecording,
  setSpeakers,
  startProcessing,
  storedLines,
} from "~/lib/meeting-recording.server";
import { runCreateTask, CreateTaskError } from "~/mcp/tools/create-task";
import { actionItemMatchesBlock, type StoredEnhanceNotes } from "~/components/meeting-recorder/enhance-plan";
import { formatClock } from "~/components/meeting-recorder/transcript";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

// An editor's final stop (Transcribe anyway) is refused while the owner's
// device still looks live: stopRequested not yet set and a chunk within
// this window. Older than this (or no chunk ever) reads as abandoned.
const EDITOR_FINAL_STOP_STALE_MS = 2 * 60_000;

// priorBlocks (specs/meeting-recording-rail.md Step 2): full prior DocBlock
// JSON for every block Enhance changed, keyed by block id — capped well
// under the request body's own ceiling so one outsized note can't bloat the
// recording row indefinitely.
const MAX_PRIOR_BLOCKS_BYTES = 512 * 1024;
const PriorBlocksSchema = z.record(z.string(), z.unknown());

// POST {action:"createTasks"} body (specs/meeting-notes-model.md §4).
type CreateTasksItem = { index: number; title: string; assigneeId?: string; dueAt?: string };

function parseCreateTasksItems(raw: unknown): CreateTasksItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: CreateTasksItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.index !== "number" || !Number.isInteger(e.index) || e.index < 0) return null;
    if (typeof e.title !== "string" || !e.title.trim()) return null;
    if (e.assigneeId !== undefined && typeof e.assigneeId !== "string") return null;
    if (e.dueAt !== undefined && typeof e.dueAt !== "string") return null;
    items.push({
      index: e.index,
      title: e.title.trim(),
      assigneeId: typeof e.assigneeId === "string" && e.assigneeId ? e.assigneeId : undefined,
      dueAt: typeof e.dueAt === "string" && e.dueAt ? e.dueAt : undefined,
    });
  }
  return items;
}

/** The note's project, from its documentName ("doc:<pageId>:body") — null
 *  when the note isn't a Drive page on a project (ad-hoc docs, other rooms). */
async function projectForRecording(documentName: string): Promise<string | null> {
  const [entity, pageId] = documentName.split(":");
  if (entity !== "doc" || !pageId) return null;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceType: true, workspaceId: true },
  });
  if (!page || page.workspaceType !== "Project" || !page.workspaceId) return null;
  return page.workspaceId;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const rec = await prisma.meetingRecording.findUnique({ where: { id: params.id } });
  if (!rec) return notFound();

  const access = await canReadRecording(rec, auth.user.sub);
  if (!access) return notFound();

  const lines = storedLines(rec);
  const speakerNames = await resolveSpeakerNames((rec.speakers as Record<string, string> | null) ?? {});
  // Measured on the server's clock so a client whose clock is off still
  // counts the live session correctly from its own Date.now().
  const sessionSeconds =
    rec.status === "Recording" && rec.sessionStartedAt
      ? Math.max(0, (Date.now() - rec.sessionStartedAt.getTime()) / 1000)
      : null;
  if (access === "owner") {
    const since = Math.max(0, Number(new URL(request.url).searchParams.get("since")) || 0);
    return Response.json({
      status: rec.status,
      stopRequested: rec.stopRequested,
      channels: rec.channels,
      segmentStarts: rec.segmentStarts,
      recordedSeconds: rec.recordedSeconds,
      sessionSeconds,
      error: rec.error,
      progress: rec.progress ?? null,
      speakers: rec.speakers,
      speakerNames,
      total: lines.length,
      lines: lines.slice(since),
      insertedAt: rec.insertedAt?.toISOString() ?? null,
      finalizedAt: rec.finalizedAt?.toISOString() ?? null,
      notes: rec.notes ?? null,
      enhancedAt: rec.enhancedAt?.toISOString() ?? null,
      enhancedBy: rec.enhancedBy ?? null,
      reviewedAt: (rec.notes as StoredEnhanceNotes | null)?.reviewedAt ?? null,
      lastChunkAt: rec.lastChunkAt?.toISOString() ?? null,
    });
  }

  return Response.json({
    status: rec.status,
    lines,
    speakers: rec.speakers,
    speakerNames,
    channels: rec.channels,
    recordedSeconds: rec.recordedSeconds,
    sessionSeconds,
    progress: rec.progress ?? null,
    insertedAt: rec.insertedAt?.toISOString() ?? null,
    notes: rec.notes ?? null,
    enhancedAt: rec.enhancedAt?.toISOString() ?? null,
    enhancedBy: rec.enhancedBy ?? null,
    reviewedAt: (rec.notes as StoredEnhanceNotes | null)?.reviewedAt ?? null,
    lastChunkAt: rec.lastChunkAt?.toISOString() ?? null,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const rec = await prisma.meetingRecording.findUnique({ where: { id: params.id } });
  if (!rec) return notFound();

  if (request.method === "DELETE") {
    if (rec.userId !== auth.user.sub && !(await isCore(auth.user.sub))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    await deletePrefix(rec.id);
    await prisma.meetingRecording.delete({ where: { id: rec.id } });
    await logAuditEvent({
      action: "recording.discard",
      userId: auth.user.sub,
      targetId: rec.id,
      metadata: { ownerId: rec.userId, documentName: rec.documentName, status: rec.status },
      request,
    });
    return Response.json({ ok: true });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (body.action === "append") {
    return Response.json({ error: "Update the DALI OS app to record." }, { status: 410 });
  }

  // speakers, inserted, enhanced, reviewed, and createTasks are the actions
  // any editor of the note may take; everything else is owner-only.
  if (
    body.action === "speakers" ||
    body.action === "inserted" ||
    body.action === "enhanced" ||
    body.action === "reviewed" ||
    body.action === "createTasks"
  ) {
    if (!(await canRecordInto(auth.user.sub, rec.documentName))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (body.action === "createTasks") {
      const items = parseCreateTasksItems(body.items);
      if (!items) return Response.json({ error: "Invalid items" }, { status: 400 });

      const projectId = await projectForRecording(rec.documentName);
      if (!projectId) {
        return Response.json({ error: "This meeting has no project." }, { status: 400 });
      }

      const [entity, pageId] = rec.documentName.split(":");
      const notes = (rec.notes ?? null) as StoredEnhanceNotes | null;
      const actionItems = notes ? [...notes.plan.actionItems] : [];
      const created: { index: number; taskId: string }[] = [];
      // Persist task ids as soon as any exist, including on a mid-loop
      // failure, so a retry can't create the same task twice.
      const saveTaskIds = async () => {
        if (created.length === 0 || !notes) return;
        await prisma.meetingRecording.update({
          where: { id: rec.id },
          data: { notes: { ...notes, plan: { ...notes.plan, actionItems } } as Prisma.InputJsonValue },
        });
      };

      // A re-run (Enhance again) can renumber action items, so an item's
      // taskId at its OWN index may be missing even though an earlier run
      // already made a Task for the same text — dedup by matching title
      // against this recording's existing tasks too (specs/meeting-notes-
      // model.md §5), not just by index.
      const existingTasks = await prisma.task.findMany({
        where: { sourceRecordingId: rec.id },
        select: { id: true, title: true },
      });
      const noteTitle = (entity === "doc" && pageId ? await documentTitle(rec.documentName) : null) || "Untitled";
      const origin = new URL(request.url).origin;

      for (const item of items) {
        const existing = actionItems[item.index];
        if (!existing || existing.taskId) continue; // out of range, or already created — dedup.

        const dupe = existingTasks.find((t) => actionItemMatchesBlock(item.title, t.title));
        if (dupe) {
          actionItems[item.index] = { ...existing, taskId: dupe.id };
          created.push({ index: item.index, taskId: dupe.id });
          continue;
        }

        const citeAt = existing.cites?.[0];
        const description =
          entity === "doc" && pageId && citeAt !== undefined
            ? `Action item from "${noteTitle}" at ${formatClock(citeAt)}.\n${origin}/documents/${pageId}?transcript=${rec.id}&at=${Math.max(0, Math.round(citeAt))}`
            : undefined;

        let task: { id: string };
        try {
          task = await runCreateTask(auth.user.sub, {
            projectId,
            title: item.title,
            description,
            assigneeUserIds: item.assigneeId ? [item.assigneeId] : undefined,
            dueAt: item.dueAt,
            sourceRecordingId: rec.id,
          });
        } catch (err) {
          await saveTaskIds();
          if (err instanceof CreateTaskError) {
            return Response.json({ error: err.message, created }, { status: err.status });
          }
          throw err;
        }

        actionItems[item.index] = { ...existing, taskId: task.id };
        created.push({ index: item.index, taskId: task.id });
      }

      await saveTaskIds();
      return Response.json({ created });
    }
    if (body.action === "inserted") {
      await prisma.meetingRecording.update({
        where: { id: rec.id },
        data: { insertedAt: rec.insertedAt ?? new Date() },
      });
      return Response.json({ ok: true });
    }
    if (body.action === "enhanced") {
      const snapshotAt = typeof body.snapshotAt === "string" ? body.snapshotAt : null;
      if (!snapshotAt) return Response.json({ error: "snapshotAt is required" }, { status: 400 });
      // The enhance lock (specs/meeting-notes-model.md §2): refuse the apply
      // when someone else's `notes` write landed after this client's preview
      // snapshot — the two-editors-at-once case. Older/equal snapshots are
      // fine: this is the editor that generated (or re-generated) `notes`.
      const stored = rec.notes as { snapshotAt?: string } | null;
      if (
        stored &&
        typeof stored.snapshotAt === "string" &&
        new Date(stored.snapshotAt).getTime() > new Date(snapshotAt).getTime()
      ) {
        return Response.json({ error: "stale" }, { status: 409 });
      }

      let priorBlocks: Record<string, unknown> | undefined;
      if (body.priorBlocks !== undefined) {
        const parsed = PriorBlocksSchema.safeParse(body.priorBlocks);
        if (!parsed.success) return Response.json({ error: "Invalid priorBlocks" }, { status: 400 });
        if (JSON.stringify(parsed.data).length > MAX_PRIOR_BLOCKS_BYTES) {
          return Response.json({ error: "priorBlocks too large" }, { status: 413 });
        }
        priorBlocks = parsed.data;
      }

      const enhancedBy = [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
      const enhancedAt = new Date();
      await prisma.meetingRecording.update({
        where: { id: rec.id },
        data: {
          enhancedAt,
          enhancedBy,
          ...(priorBlocks !== undefined
            ? { notes: { ...((rec.notes as object) ?? {}), priorBlocks } as Prisma.InputJsonValue }
            : {}),
        },
      });
      return Response.json({ ok: true, enhancedAt: enhancedAt.toISOString(), enhancedBy });
    }
    if (body.action === "reviewed") {
      const reviewedAt = new Date().toISOString();
      await prisma.meetingRecording.update({
        where: { id: rec.id },
        data: { notes: { ...((rec.notes as object) ?? {}), reviewedAt } as Prisma.InputJsonValue },
      });
      return Response.json({ ok: true, reviewedAt });
    }
    const patch = parseSpeakerMap(body.speakers);
    if (!patch) return Response.json({ error: "Invalid speakers" }, { status: 400 });
    await setSpeakers(rec, patch);
    return Response.json({ ok: true });
  }

  // stop (unlike claim/resume/finish) isn't owner-only: the owner's device
  // can go silent mid-recording, and an editor needs a way to end it without
  // waiting on the finalizer. A non-final stop just raises stopRequested, so
  // any editor may send one; a final stop (Transcribe anyway) additionally
  // requires the owner's device to look done uploading.
  if (body.action === "stop") {
    const isOwner = rec.userId === auth.user.sub;
    if (!isOwner && !(await canRecordInto(auth.user.sub, rec.documentName))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    // A failed dispatch leaves the audio in place (finalizedAt null), so
    // stop { final } doubles as Try again. Once the audio is gone there is
    // nothing to re-run.
    if (rec.finalizedAt !== null || rec.status === "Processing" || rec.status === "Done") {
      return Response.json({ error: "This recording can't be processed again." }, { status: 409 });
    }
    if (body.final === true && !isOwner) {
      const ownerDeviceDone =
        rec.stopRequested ||
        rec.lastChunkAt === null ||
        rec.lastChunkAt.getTime() < Date.now() - EDITOR_FINAL_STOP_STALE_MS;
      if (!ownerDeviceDone) {
        return Response.json({ error: "ownerOnly" }, { status: 403 });
      }
    }
    await requestStop(rec);
    if (body.final === true) {
      if (rec.channels.length > 0) {
        await startProcessing(rec);
      } else {
        await finalizeEmpty(rec);
      }
    }
    await logAuditEvent({
      action: "recording.stop",
      userId: auth.user.sub,
      targetId: rec.id,
      metadata: { final: body.final === true, byOwner: isOwner },
      request,
    });
    return Response.json({ ok: true });
  }

  if (rec.userId !== auth.user.sub) return notFound();

  switch (body.action) {
    case "claim": {
      const result = await claimRecording(rec);
      if (!result.ok) {
        return Response.json({ error: "This recording can't be claimed." }, { status: 409 });
      }
      return Response.json({ offset: result.offset, segment: result.segment });
    }
    case "resume":
      if (!(await resumeRecording(rec))) {
        return Response.json({ error: "This recording can't be resumed." }, { status: 409 });
      }
      return Response.json({ ok: true });
    case "finish":
      await finishRecording(
        rec,
        typeof body.error === "string" && body.error ? body.error : null,
        typeof body.seconds === "number" ? body.seconds : 0,
      );
      return Response.json({ ok: true });
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
