// POST /api/ai/meeting-notes — turns a meeting transcript into notes for the
// collaborative document it was recorded on. The transcript is transcribed
// on-device by the desktop app (see api.meeting-recordings.$id), so no audio
// reaches the server. Requires the `ai-meeting-notes` flag, write access to
// the document's collab room, and a configured AI provider (503 otherwise). Shares the doc
// assistant's per-user burst limit and daily quota shape.
//
// NEVER log the API key, JWT, cookies, or the transcript.

import type { Route } from "./+types/api.ai.meeting-notes";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";
import { generateShortText } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canRecordInto, documentTitle } from "~/lib/meeting-recording.server";
import { getUserRoles } from "~/lib/roles";
import { checkRateLimit } from "~/lib/rate-limit";
import { prisma } from "~/lib/db";

export interface MeetingNotesResponse {
  markdown: string;
}

const AI_BURST_MAX = 10;
const AI_BURST_WINDOW_MS = 60_000;
const AI_DAILY_MAX = 200;

// Roughly two hours of speech. Longer recordings keep their most recent part.
export const TRANSCRIPT_MAX = 120_000;

const SYSTEM_PROMPT = `You write meeting notes for a university software lab from a raw speech-to-text transcript. \
Each line is "[mm:ss] Speaker: text". "You" is the person who recorded (their microphone) and "Others" is everyone else on the call (the computer's audio); there are no other speaker names. Words may be misheard, and it may start or stop mid-sentence. \
Write in Markdown with exactly these sections, in order: "### Summary" (2-5 sentences), "### Decisions" (bullets), "### Action items" (bullets as "- [ ] owner: task" when an owner is clear, otherwise "- [ ] task"). \
Write "None noted." under a section with nothing in it. \
Only include what the transcript supports. Don't invent names, dates, or numbers, and fix obvious transcription errors only when the meaning is clear. \
No preamble, no title, no closing remarks.`;

function secondsToUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const documentName = typeof b.documentName === "string" ? b.documentName : "";
  const transcript = typeof b.transcript === "string" ? b.transcript.trim().slice(-TRANSCRIPT_MAX) : "";
  if (!documentName) return Response.json({ error: "documentName is required" }, { status: 400 });
  if (!transcript) return Response.json({ error: "Nothing was transcribed." }, { status: 400 });

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("ai-meeting-notes", auth.user.sub, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  // Only for someone who could write the result into the document.
  if (!(await canRecordInto(auth.user.sub, documentName))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const title = await documentTitle(documentName);

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

  try {
    const result = await generateShortText({
      system: SYSTEM_PROMPT,
      prompt: `${title ? `Document: ${title}\n\n` : ""}Transcript:\n${transcript}`,
      maxTokens: 2000,
    });
    if (!result) return Response.json({ aiEnabled: false }, { status: 503 });
    await recordTokenUsage(auth.user.sub, day, result.inputTokens, result.outputTokens);
    return Response.json({ markdown: result.text } satisfies MeetingNotesResponse);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: "AI service error" }, { status: 502 });
    }
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }
}
