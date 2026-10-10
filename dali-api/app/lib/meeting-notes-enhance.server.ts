// Shared core of Enhance generation (specs/meeting-notes-model.md §2, §6):
// build the roster/meeting context, call the model, verify the plan against
// the real transcript, and persist it on the recording. Both
// POST /api/ai/meeting-notes/enhance and the MCP `enhance_meeting_notes` tool
// call this — everything specific to the caller (auth, the AI feature flag,
// per-user burst rate limiting) stays at each call site, since those checks
// need a Request/session in one case and an MCP scope in the other.
//
// NEVER log the transcript, the note's text, or the model's raw response.

import Anthropic from "@anthropic-ai/sdk";
import { generateShortText, resolveAiProvider } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { formatRecordingTranscript, storedLines } from "~/lib/meeting-recording.server";
import { verifyEnhancePlan, type VerifyRosterUser } from "~/lib/meeting-notes-verify";
import { fullName } from "~/lib/display";
import { prisma } from "~/lib/db";
import type { MeetingRecording } from "~/generated/prisma/client";
import type { EnhancePlan, SnapshotBlock, StoredEnhanceNotes } from "~/components/meeting-recorder/enhance-plan";
import { AI_DAILY_MAX, secondsToUtcMidnight, TRANSCRIPT_MAX } from "~/routes/api.ai.meeting-notes";
import { z } from "zod";

const MAX_BLOCKS = 500;

export const EnhanceBlocksSchema = z
  .array(z.object({ id: z.string().min(1), type: z.string().min(1), text: z.string() }))
  .max(MAX_BLOCKS);

const EnhanceBlockOpSchema = z.union([
  z.object({ id: z.string(), op: z.literal("keep") }),
  z.object({ id: z.string(), op: z.literal("expand"), text: z.string(), cites: z.array(z.number()).optional() }),
  z.object({
    op: z.literal("insert"),
    after: z.string().nullable(),
    type: z.string(),
    text: z.string(),
    cites: z.array(z.number()).optional(),
    added: z.boolean().optional(),
  }),
]);

const EnhanceActionItemSchema = z.object({
  text: z.string(),
  ownerName: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
  dueSource: z.string().nullable().optional(),
  cites: z.array(z.number()).optional(),
});

const EnhancePlanSchema = z.object({
  blocks: z.array(EnhanceBlockOpSchema),
  actionItems: z.array(EnhanceActionItemSchema),
});

// Action-item bullets use "checkListItem" (never "bulletListItem") so Apply
// renders them with a checkbox and Create tasks (specs/meeting-notes-model.md
// §4) can find the matching block by text to backlink the created task.
const SYSTEM_PROMPT = `You enhance meeting notes for a university software lab. You are given the note's current blocks (each with an id), a raw speech-to-text transcript with timestamps, the occurrence's roster, the meeting type, and the occurrence date. \
"You" in the transcript is the person who recorded (their microphone) and "Others" is everyone else on the call; renamed speakers use their roster name.

Rules, all mandatory:
- Keep every existing block, in order, in the author's own wording. For each block, emit either {"id","op":"keep"} (no change) or {"id","op":"expand","text","cites":[seconds,...]} — "expand" only when the transcript supports more than the author wrote, and "text" must still contain the author's original wording, just filled in.
- Add blocks the author didn't write with {"op":"insert","after":"<id or null>","type":"heading"|"paragraph"|"bulletListItem"|"checkListItem","text","cites":[seconds,...],"added":true}. "after" names the existing block id it follows. Use "checkListItem" (never "bulletListItem") for every bullet under "Action items", and make its "text" IDENTICAL to that item's "text" in "actionItems" below — that's how the two get linked. Every other inserted bullet (e.g. under "Decisions") uses "bulletListItem".
- If there is no "Decisions" or "Action items" heading among the given blocks, insert one (type "heading") plus whatever bullets the transcript supports under each, even if everything else is a "keep".
- A heading the transcript doesn't support (most often "Agenda" on an unused template) gets no inserts under it and stays "keep" — never invent content to fill it.
- Never invent names, dates, numbers, or facts the transcript doesn't support.
- Every "expand" or "insert" that draws on the transcript must cite the transcript second(s) (the line's leading [mm:ss], converted to seconds) it drew from in "cites".
- List action items separately in "actionItems": [{"text","ownerName": a roster name only (never an id, omit if unclear), "due": an ISO date resolved against the given occurrence date (omit if none), "dueSource": the phrase it came from, e.g. "by Friday" (omit if no due), "cites":[seconds,...]}].
- Respond with ONLY a single JSON object shaped exactly like: {"blocks":[...],"actionItems":[...]}. No markdown code fences, no commentary, no preamble.`;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed) ?? "";
}

function blockForPrompt(b: SnapshotBlock): string {
  return `[${b.id}] (${b.type}) ${b.text}`;
}

export type EnhanceGenerationResult =
  | { ok: true; notes: StoredEnhanceNotes }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number }
  | { ok: false; aiEnabled: false };

export type MeetingEnhanceContext = {
  roster: VerifyRosterUser[];
  meetingTypeLabel: string;
  occurrenceDate: string;
};

/** The roster, meeting-type label, and occurrence date for a recording's
 *  meeting — shared by generation (the prompt) and MCP apply (resolving
 *  speaker names for the transcript toggle it inserts). A recording with no
 *  scheduledMeetingId (an ad-hoc note) has an empty roster. */
export async function resolveMeetingEnhanceContext(
  rec: Pick<MeetingRecording, "scheduledMeetingId" | "occurrenceStart" | "createdAt">,
): Promise<MeetingEnhanceContext> {
  let roster: VerifyRosterUser[] = [];
  let meetingTypeLabel = "Meeting";
  let occurrenceDate = (rec.occurrenceStart ?? rec.createdAt).toISOString().slice(0, 10);
  if (rec.scheduledMeetingId) {
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { id: rec.scheduledMeetingId },
      select: {
        organizerId: true,
        organizer: { select: { firstName: true, lastName: true, daliEmail: true } },
        meetingType: true,
        meetingTypeLabel: true,
        selectedAt: true,
        createdAt: true,
      },
    });
    if (meeting) {
      const occurrenceStart = rec.occurrenceStart ?? meeting.selectedAt ?? meeting.createdAt;
      occurrenceDate = occurrenceStart.toISOString().slice(0, 10);
      meetingTypeLabel =
        meeting.meetingType === "Other" ? meeting.meetingTypeLabel || "Other" : meeting.meetingType ?? "Meeting";
      const attendance = await prisma.meetingAttendance.findMany({
        where: { scheduledMeetingId: rec.scheduledMeetingId, occurrenceStart },
        select: { userId: true, user: { select: { firstName: true, lastName: true, daliEmail: true } } },
      });
      const byId = new Map<string, VerifyRosterUser>();
      byId.set(meeting.organizerId, {
        userId: meeting.organizerId,
        name: fullName(meeting.organizer) || meeting.organizer.daliEmail || meeting.organizerId,
      });
      for (const a of attendance) {
        byId.set(a.userId, { userId: a.userId, name: fullName(a.user) || a.user.daliEmail || a.userId });
      }
      roster = Array.from(byId.values());
    }
  }
  return { roster, meetingTypeLabel, occurrenceDate };
}

/**
 * Builds the roster/meeting-type/occurrence-date context for `rec`, calls the
 * model, verifies the result against the real transcript and roster, and
 * persists it on the recording. Callers have already checked the AI feature
 * flag, the caller's edit access to the note, and rate limits.
 */
export async function generateAndVerifyEnhancePlan(params: {
  rec: Pick<
    MeetingRecording,
    "id" | "scheduledMeetingId" | "occurrenceStart" | "createdAt" | "lines" | "speakers"
  >;
  blocks: SnapshotBlock[];
  untouchedTemplate: boolean;
  userId: string;
}): Promise<EnhanceGenerationResult> {
  const { rec, blocks, untouchedTemplate, userId } = params;

  const lines = storedLines(rec);
  if (!lines.length) return { ok: false, status: 400, error: "Nothing was transcribed." };
  const transcript = (await formatRecordingTranscript(rec)).slice(-TRANSCRIPT_MAX);

  const { roster, meetingTypeLabel, occurrenceDate } = await resolveMeetingEnhanceContext(rec);

  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > AI_DAILY_MAX) {
    return {
      ok: false,
      status: 429,
      error: `You've reached today's AI limit (${AI_DAILY_MAX} requests). It resets at midnight UTC.`,
      retryAfterSeconds: secondsToUtcMidnight(),
    };
  }

  const prompt = [
    `Meeting type: ${meetingTypeLabel}`,
    `Occurrence date: ${occurrenceDate}`,
    `Note was an untouched template: ${untouchedTemplate ? "yes" : "no"}`,
    roster.length ? `Roster:\n${roster.map((r) => r.name).join("\n")}` : "Roster: (none on record)",
    `Current note blocks:\n${blocks.map(blockForPrompt).join("\n")}`,
    `Transcript:\n${transcript}`,
  ].join("\n\n");

  const provider = resolveAiProvider();
  if (!provider) return { ok: false, aiEnabled: false };

  let raw: { text: string; inputTokens: number; outputTokens: number } | null;
  try {
    raw = await generateShortText({
      system: SYSTEM_PROMPT,
      prompt,
      maxTokens: 4000,
      model: provider.sonnetModel,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { ok: false, status: 502, error: "AI service error" };
    }
    return { ok: false, status: 502, error: "AI request failed" };
  }
  if (!raw) return { ok: false, aiEnabled: false };
  await recordTokenUsage(userId, day, raw.inputTokens, raw.outputTokens);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw.text));
  } catch {
    return { ok: false, status: 502, error: "AI response could not be parsed" };
  }
  const result = EnhancePlanSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, status: 502, error: "AI response could not be parsed" };
  }
  const modelPlan: EnhancePlan = result.data;

  const { plan, verified } = verifyEnhancePlan(modelPlan, lines, roster);
  const snapshotAt = new Date().toISOString();
  const notes: StoredEnhanceNotes = { plan, verified, snapshotAt, snapshot: blocks };

  await prisma.meetingRecording.update({ where: { id: rec.id }, data: { notes } });

  return { ok: true, notes };
}
