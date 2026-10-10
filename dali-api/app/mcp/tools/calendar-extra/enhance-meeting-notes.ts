// MCP `enhance_meeting_notes` — specs/meeting-notes-model.md §2, §4, §6.
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

import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { canRecordInto, storedLines } from "~/lib/meeting-recording.server";
import { getCollabServer } from "~/collab/server";
import { forceSnapshot } from "~/collab/persistence";
import { readDocAsBlocks } from "~/collab/read";
import { replaceCollabDocContent } from "~/collab/write";
import { blockOwnText, blocksToPlainText } from "~/components/doc/schema/configs";
import { applyEnhancePlan, type SnapshotBlock, type StoredEnhanceNotes } from "~/components/meeting-recorder/enhance-plan";
import { transcriptParagraphs } from "~/components/meeting-recorder/transcript";
import type { Channel, RosterUser, Speakers } from "~/components/meeting-recorder/types";
import { isUntouchedTemplate } from "~/lib/meeting-note-template";
import { generateAndVerifyEnhancePlan, resolveMeetingEnhanceContext } from "~/lib/meeting-notes-enhance.server";
import { applyEnhanceOpsToDocBlocks, ensureTranscriptToggle } from "~/lib/meeting-notes-apply.server";
import { AI_BURST_MAX, AI_BURST_WINDOW_MS } from "~/routes/api.ai.meeting-notes";
import type { McpCtx } from "../../registry";
import { McpError, McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../registry";

export const ENHANCE_MEETING_NOTES_DEF = {
  name: "enhance_meeting_notes",
  description:
    "Preview or apply Enhance for a finished meeting recording (specs/meeting-notes-model.md §2): merges the transcript into the note's typed blocks, citing the moments it drew from, and files Decisions/Action items the author missed. Preview (apply omitted/false) regenerates the plan and returns it, verified against the real transcript — call this first. Apply (apply: true) merges the most recently previewed plan into the live note and marks it enhanced; it fails with a 409-equivalent error if someone else re-previewed after you did, meaning you should preview again before retrying. Requires edit access to the note, same as the Enhance button.",
  inputSchema: {
    type: "object" as const,
    properties: {
      recordingId: { type: "string", minLength: 1, description: "MeetingRecording.id." },
      apply: {
        type: "boolean",
        description: "true to merge the previewed plan into the note. Defaults to false (preview only).",
      },
    },
    required: ["recordingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { recordingId: string; apply?: boolean };

async function resolvePageSeed(documentName: string): Promise<{
  pageId: string | null;
  seededFromPageId: string | null;
  seededTemplateHash: string | null;
  projectId: string | null;
}> {
  const [entity, pageId] = documentName.split(":");
  if (entity !== "doc" || !pageId) {
    return { pageId: null, seededFromPageId: null, seededTemplateHash: null, projectId: null };
  }
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { seededFromPageId: true, seededTemplateHash: true, workspaceType: true, workspaceId: true },
  });
  return {
    pageId,
    seededFromPageId: page?.seededFromPageId ?? null,
    seededTemplateHash: page?.seededTemplateHash ?? null,
    projectId: page?.workspaceType === "Project" ? page.workspaceId : null,
  };
}

export async function runEnhanceMeetingNotes(ctx: McpCtx, input: Input) {
  const callerId = ctx.user.id;
  const rec = await prisma.meetingRecording.findUnique({ where: { id: input.recordingId } });
  if (!rec) throw new McpNotFoundError("Recording not found");

  const roles = await getUserRoles(callerId, ctx.request);
  if (!(await isFeatureEnabled("ai-meeting-notes", callerId, roles, ctx.request))) {
    throw new McpForbiddenError("Not available");
  }
  if (!(await canRecordInto(callerId, rec.documentName))) {
    throw new McpForbiddenError("Forbidden");
  }
  const burstLimited = checkRateLimit(
    ctx.request,
    { max: AI_BURST_MAX, windowMs: AI_BURST_WINDOW_MS },
    `ai-meeting-notes:${callerId}`,
  );
  if (burstLimited) {
    throw new McpError("Too many requests. Try again shortly.", 429);
  }

  const { pageId, seededFromPageId, seededTemplateHash, projectId } = await resolvePageSeed(rec.documentName);

  if (!input.apply) {
    const liveBlocks = await readDocAsBlocks(rec.documentName);
    const blocks: SnapshotBlock[] = liveBlocks.map((b) => ({ id: b.id, type: b.type, text: blockOwnText(b) }));
    const untouchedTemplate = isUntouchedTemplate(
      { seededFromPageId, seededTemplateHash },
      blocksToPlainText(liveBlocks),
    );
    const result = await generateAndVerifyEnhancePlan({ rec, blocks, untouchedTemplate, userId: callerId });
    if (!result.ok) {
      if ("aiEnabled" in result) throw new McpError("AI isn't configured.", 503);
      throw new McpError(result.error, result.status);
    }
    return { plan: result.notes.plan, verified: result.notes.verified, snapshotAt: result.notes.snapshotAt };
  }

  // apply: true — merge the plan already stored on the recording (from this
  // tool's own prior preview call, the web UI's auto-preview, or a teammate's
  // preview) into the live doc.
  const stored = rec.notes as StoredEnhanceNotes | null;
  if (!stored) {
    throw new McpInvalidError("No enhance preview to apply yet. Call this tool with apply:false first.");
  }
  if (!pageId) {
    throw new McpInvalidError("This recording's note isn't a Drive page.");
  }

  const server = getCollabServer();
  if (!server) throw new McpError("Collab server not running", 503);

  await forceSnapshot(server, rec.documentName, "Before enhance", [callerId]);

  const liveBlocks = await readDocAsBlocks(rec.documentName);
  const currentTop: SnapshotBlock[] = liveBlocks.map((b) => ({ id: b.id, type: b.type, text: blockOwnText(b) }));
  const untouchedTemplate = isUntouchedTemplate(
    { seededFromPageId, seededTemplateHash },
    blocksToPlainText(liveBlocks),
  );
  const { ops } = applyEnhancePlan(stored.snapshot, currentTop, stored.plan, { untouchedTemplate });
  const merged = applyEnhanceOpsToDocBlocks(ops, liveBlocks, {
    pageId,
    recordingId: rec.id,
    actionItems: stored.plan.actionItems,
    projectId,
  });

  const { roster } = await resolveMeetingEnhanceContext(rec);
  // All recordings are v2 (ai-meeting-notes was off before this release), so
  // channel/end are always set in practice — normalized defensively, same as
  // get-meeting-transcript.ts.
  const lines = storedLines(rec).map((l) => ({
    ...l,
    channel: (l.channel ?? "mic") as Channel,
    end: l.end ?? l.at,
  }));
  const paragraphs = transcriptParagraphs(lines, (rec.speakers as Speakers | null) ?? {}, roster as RosterUser[]);
  const withTranscript = ensureTranscriptToggle(merged, paragraphs);

  // Same staleness check as the web route's {action:"enhanced"} lock: refuse
  // when a newer preview landed while this merge was being computed.
  const fresh = await prisma.meetingRecording.findUnique({ where: { id: rec.id }, select: { notes: true } });
  const freshNotes = fresh?.notes as StoredEnhanceNotes | null;
  if (freshNotes?.snapshotAt && freshNotes.snapshotAt !== stored.snapshotAt) {
    throw new McpError("stale", 409);
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
