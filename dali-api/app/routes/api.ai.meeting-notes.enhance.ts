// POST /api/ai/meeting-notes/enhance — specs/meeting-notes-model.md §2.
// Takes the note's current top-level blocks (as the enhancer's own editor
// sees them) plus the recording's transcript and roster, asks Claude Sonnet
// 5 for a block-keyed merge plan, verifies every citation and inserted block
// against the real transcript, resolves owner names to roster user ids, and
// stores the verified plan on the recording. Nothing past verifyEnhancePlan
// is trusted model output.
//
// Same flag gate, permission check, and per-user burst/daily budget as
// api/ai/meeting-notes (Write notes) — Enhance replaces that button once
// someone has typed, so it draws on the same quota rather than a second one.
//
// NEVER log the transcript, the note's text, or the model's raw response.

import type { Route } from "./+types/api.ai.meeting-notes.enhance";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";
import { generateShortText, resolveAiProvider } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canRecordInto, formatRecordingTranscript, storedLines } from "~/lib/meeting-recording.server";
import { verifyEnhancePlan, type VerifyRosterUser } from "~/lib/meeting-notes-verify";
import { fullName } from "~/lib/display";
import { getUserRoles } from "~/lib/roles";
import { checkRateLimit } from "~/lib/rate-limit";
import { parseJson } from "~/lib/validate";
import { prisma } from "~/lib/db";
import type { EnhancePlan, SnapshotBlock, StoredEnhanceNotes } from "~/components/meeting-recorder/enhance-plan";
import { AI_BURST_MAX, AI_BURST_WINDOW_MS, AI_DAILY_MAX, secondsToUtcMidnight, TRANSCRIPT_MAX } from "./api.ai.meeting-notes";

const MAX_BLOCKS = 500;

const RequestSchema = z.object({
  recordingId: z.string().min(1),
  blocks: z
    .array(z.object({ id: z.string().min(1), type: z.string().min(1), text: z.string() }))
    .max(MAX_BLOCKS),
  untouchedTemplate: z.boolean(),
});

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

const SYSTEM_PROMPT = `You enhance meeting notes for a university software lab. You are given the note's current blocks (each with an id), a raw speech-to-text transcript with timestamps, the occurrence's roster, the meeting type, and the occurrence date. \
"You" in the transcript is the person who recorded (their microphone) and "Others" is everyone else on the call; renamed speakers use their roster name.

Rules, all mandatory:
- Keep every existing block, in order, in the author's own wording. For each block, emit either {"id","op":"keep"} (no change) or {"id","op":"expand","text","cites":[seconds,...]} — "expand" only when the transcript supports more than the author wrote, and "text" must still contain the author's original wording, just filled in.
- Add blocks the author didn't write with {"op":"insert","after":"<id or null>","type":"heading"|"paragraph"|"bulletListItem","text","cites":[seconds,...],"added":true}. "after" names the existing block id it follows.
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

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const burstLimited = checkRateLimit(
    request,
    { max: AI_BURST_MAX, windowMs: AI_BURST_WINDOW_MS },
    `ai-meeting-notes:${auth.user.sub}`,
  );
  if (burstLimited) {
    const retryAfter = burstLimited.headers.get("Retry-After") ?? "60";
    return Response.json(
      { error: `Too many requests. Try again in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": retryAfter } },
    );
  }

  const body = await parseJson(request, RequestSchema);
  if (body instanceof Response) return body;

  const rec = await prisma.meetingRecording.findUnique({ where: { id: body.recordingId } });
  if (!rec) return Response.json({ error: "Recording not found" }, { status: 404 });

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("ai-meeting-notes", auth.user.sub, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }
  if (!(await canRecordInto(auth.user.sub, rec.documentName))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId: auth.user.sub, day } },
    create: { userId: auth.user.sub, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > AI_DAILY_MAX) {
    return Response.json(
      { error: `You've reached today's AI limit (${AI_DAILY_MAX} requests). It resets at midnight UTC.` },
      { status: 429, headers: { "Retry-After": String(secondsToUtcMidnight()) } },
    );
  }

  const lines = storedLines(rec);
  if (!lines.length) return Response.json({ error: "Nothing was transcribed." }, { status: 400 });
  const transcript = (await formatRecordingTranscript(rec)).slice(-TRANSCRIPT_MAX);

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

  const prompt = [
    `Meeting type: ${meetingTypeLabel}`,
    `Occurrence date: ${occurrenceDate}`,
    `Note was an untouched template: ${body.untouchedTemplate ? "yes" : "no"}`,
    roster.length ? `Roster:\n${roster.map((r) => r.name).join("\n")}` : "Roster: (none on record)",
    `Current note blocks:\n${body.blocks.map(blockForPrompt).join("\n")}`,
    `Transcript:\n${transcript}`,
  ].join("\n\n");

  const provider = resolveAiProvider();
  if (!provider) return Response.json({ aiEnabled: false }, { status: 503 });

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
      return Response.json({ error: "AI service error" }, { status: 502 });
    }
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }
  if (!raw) return Response.json({ aiEnabled: false }, { status: 503 });
  await recordTokenUsage(auth.user.sub, day, raw.inputTokens, raw.outputTokens);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw.text));
  } catch {
    return Response.json({ error: "AI response could not be parsed" }, { status: 502 });
  }
  const result = EnhancePlanSchema.safeParse(parsed);
  if (!result.success) {
    return Response.json({ error: "AI response could not be parsed" }, { status: 502 });
  }
  const modelPlan: EnhancePlan = result.data;

  const { plan, verified } = verifyEnhancePlan(modelPlan, lines, roster);
  const snapshotAt = new Date().toISOString();
  const notes: StoredEnhanceNotes = { plan, verified, snapshotAt, snapshot: body.blocks };

  await prisma.meetingRecording.update({ where: { id: rec.id }, data: { notes } });

  return Response.json(notes);
}
