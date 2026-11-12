// Enhance preview/apply for a finished meeting recording (specs/meeting-notes-model.md §2, §4, §6).
// Shared by the MCP `enhance_meeting_notes` tool and POST /api/mobile/notes/:id.
//
// Preview (apply omitted/false): the same generation + verification as
// POST /api/ai/meeting-notes/enhance — regenerates the plan from the note's
// current blocks and the transcript, and returns the verified result.
// Apply (apply: true): merges the most recently previewed plan (stored on
// the recording) into the live note through a direct Hocuspocus connection —
// snapshot ("Before enhance"), decode the live doc through the clone-safe
// read path, run the same client-side merge rule, write the result, insert
// the transcript toggle if absent, then stamp enhancedAt/enhancedBy with the
// same "did someone else re-preview after this one" staleness check the web
// route's {action:"enhanced"} lock applies.
//
// Same permission, AI feature flag, and per-user burst rate limit as the web
// route: edit access to the note (canRecordInto).
//
// NEVER log the transcript, the note's text, or the model's raw response.

import { prisma } from "~/lib/db.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { canRecordInto, resolveSpeakerNames, storedLines } from "~/lib/meeting-recording.server";
import { getCollabServer } from "~/collab/server";
import { forceSnapshot } from "~/collab/persistence";
import { readDocAsBlocks } from "~/collab/read";
import { replaceCollabDocContent } from "~/collab/write";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import {
  applyEnhancePlan,
  type StoredEnhanceNotes,
} from "~/components/meeting-recorder/enhance-plan";
import { speakerFirstNameAt, transcriptParagraphs } from "~/components/meeting-recorder/transcript";
import type { Channel, RosterUser, Speakers } from "~/components/meeting-recorder/types";
import { isUntouchedTemplate } from "~/lib/meeting-note-template";
import {
  generateAndVerifyEnhancePlan,
  resolveMeetingEnhanceContext,
  AI_BURST_MAX,
  AI_BURST_WINDOW_MS,
} from "~/lib/meeting-notes-enhance.server";
import {
  applyEnhanceOpsToDocBlocks,
  enhanceSnapshotDocBlocks,
  ensureTranscriptToggle,
  hasEnhanceMarkInTree,
} from "~/lib/meeting-notes-apply.server";
import { HttpError, ForbiddenError, NotFoundError, BadRequestError } from "~/lib/http-error";

type EnhanceInput = { recordingId: string; apply?: boolean };

export type EnhanceCtx = {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
  };
  request: Request;
};

async function resolvePageSeed(documentName: string): Promise<{
  pageId: string | null;
  seededFromPageId: string | null;
  seededTemplateHash: string | null;
}> {
  const [entity, pageId] = documentName.split(":");
  if (entity !== "doc" || !pageId) {
    return { pageId: null, seededFromPageId: null, seededTemplateHash: null };
  }
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { seededFromPageId: true, seededTemplateHash: true },
  });
  return {
    pageId,
    seededFromPageId: page?.seededFromPageId ?? null,
    seededTemplateHash: page?.seededTemplateHash ?? null,
  };
}

export async function enhanceMeetingNotes(ctx: EnhanceCtx, input: EnhanceInput) {
  const callerId = ctx.user.id;
  const rec = await prisma.meetingRecording.findUnique({ where: { id: input.recordingId } });
  if (!rec) throw new NotFoundError("Recording not found");

  if (!(await canRecordInto(callerId, rec.documentName))) {
    throw new ForbiddenError("Forbidden");
  }
  const burstLimited = checkRateLimit(
    ctx.request,
    { max: AI_BURST_MAX, windowMs: AI_BURST_WINDOW_MS },
    `ai-meeting-notes:${callerId}`,
  );
  if (burstLimited) {
    throw new HttpError(429, "Too many requests. Try again shortly.");
  }

  const { pageId, seededFromPageId, seededTemplateHash } = await resolvePageSeed(rec.documentName);

  if (!input.apply) {
    const liveBlocks = await readDocAsBlocks(rec.documentName);
    const blocks = enhanceSnapshotDocBlocks(liveBlocks);
    const untouchedTemplate = isUntouchedTemplate(
      { seededFromPageId, seededTemplateHash },
      blocksToPlainText(liveBlocks),
    );
    const result = await generateAndVerifyEnhancePlan({ rec, blocks, untouchedTemplate, userId: callerId });
    if (!result.ok) {
      if ("aiEnabled" in result) throw new HttpError(503, "AI isn't configured.");
      throw new HttpError(result.status, result.error);
    }
    return { plan: result.notes.plan, verified: result.notes.verified, snapshotAt: result.notes.snapshotAt };
  }

  // apply: true — merge the plan already stored on the recording (from this
  // tool's own prior preview call, the web UI's auto-preview, or a teammate's
  // preview) into the live doc.
  const stored = rec.notes as StoredEnhanceNotes | null;
  if (!stored) {
    throw new BadRequestError("No enhance preview to apply yet. Call this tool with apply:false first.");
  }
  if (!pageId) {
    throw new BadRequestError("This recording's note isn't a Drive page.");
  }

  const server = getCollabServer();
  if (!server) throw new HttpError(503, "Collab server not running");

  // Refuse before snapshotting or writing anything (specs/meeting-recording-
  // rail.md Step 2: "Server write paths refuse while marks exist") — an
  // unreviewed Enhance pass is still sitting in the note.
  const liveBlocks = await readDocAsBlocks(rec.documentName);
  if (hasEnhanceMarkInTree(liveBlocks)) {
    throw new HttpError(409, "Keep or revert the current changes first");
  }

  await forceSnapshot(server, rec.documentName, "Before enhance", [callerId]);

  const current = enhanceSnapshotDocBlocks(liveBlocks);
  const untouchedTemplate = isUntouchedTemplate(
    { seededFromPageId, seededTemplateHash },
    blocksToPlainText(liveBlocks),
  );
  const { ops } = applyEnhancePlan(stored.snapshot, current, stored.plan, { untouchedTemplate });
  const { roster } = await resolveMeetingEnhanceContext(rec);
  // All recordings are v2 (ai-meeting-notes was off before this release), so
  // channel/end are always set in practice — normalized defensively, same as
  // get-meeting-transcript.ts.
  const lines = storedLines(rec).map((l) => ({
    ...l,
    channel: (l.channel ?? "mic") as Channel,
    end: l.end ?? l.at,
  }));
  const speakers = (rec.speakers as Speakers | null) ?? {};
  const speakerNames = await resolveSpeakerNames(speakers);
  const merged = applyEnhanceOpsToDocBlocks(ops, liveBlocks, {
    pageId,
    recordingId: rec.id,
    speakerAt: (at) => speakerFirstNameAt(lines, at, speakers, roster as RosterUser[], speakerNames),
  });

  const paragraphs = transcriptParagraphs(lines, speakers, roster as RosterUser[]);
  const withTranscript = ensureTranscriptToggle(merged, paragraphs);

  // Same staleness check as the web route's {action:"enhanced"} lock: refuse
  // when a newer preview landed while this merge was being computed.
  const fresh = await prisma.meetingRecording.findUnique({ where: { id: rec.id }, select: { notes: true } });
  const freshNotes = fresh?.notes as StoredEnhanceNotes | null;
  if (freshNotes?.snapshotAt && freshNotes.snapshotAt !== stored.snapshotAt) {
    throw new HttpError(409, "stale");
  }

  await replaceCollabDocContent(rec.documentName, withTranscript, callerId);

  const enhancedBy =
    [ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(" ") ||
    ctx.user.daliEmail ||
    ctx.user.dartmouthEmail ||
    callerId;
  const enhancedAt = new Date();
  await prisma.meetingRecording.update({ where: { id: rec.id }, data: { enhancedAt, enhancedBy } });

  return { applied: true, enhancedAt: enhancedAt.toISOString(), enhancedBy };
}
