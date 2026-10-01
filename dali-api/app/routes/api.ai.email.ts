// POST /api/ai/email: the Email tab's AI tools.
//   { task: "draft" | "rephrase" | "proofread" | "translate", text, instruction?,
//     language?, accountId?, threadId? }            → { text }
//   { task: "search", text }                         → { query, accounts }
// Same per-user burst limit and shared AiUsage daily quota as /api/ai/doc.
//
// NEVER log the API key, JWT, cookies, or email content.

import type { Route } from "./+types/api.ai.email";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";
import { generateShortText } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { prisma } from "~/lib/db";
import {
  WRITING_TASKS,
  parseSearchResponse,
  searchSystemPrompt,
  threadToContext,
  writingSystemPrompt,
  writingUserPrompt,
  type WritingTask,
} from "~/email/lib/ai-prompts";
import {
  findReadableAccount,
  mailAccountLabel,
  readableMailAccounts,
} from "~/email/lib/access.server";
import { getMailboxToken, getThread, MailboxError } from "~/email/lib/gmail-mailbox.server";

const AI_BURST_MAX = 10;
const AI_BURST_WINDOW_MS = 60_000;
const AI_DAILY_MAX = 200;
const MAX_TEXT_CHARS = 20_000;

function secondsToUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const burstLimited = checkRateLimit(
    request,
    { max: AI_BURST_MAX, windowMs: AI_BURST_WINDOW_MS },
    `ai-email:${userId}`,
  );
  if (burstLimited) {
    const retryAfter = burstLimited.headers.get("Retry-After") ?? "60";
    return Response.json(
      { error: `You're sending AI requests too quickly. Try again in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": retryAfter } },
    );
  }

  let b: Record<string, unknown>;
  try {
    b = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const task = str(b.task);
  const text = str(b.text).slice(0, MAX_TEXT_CHARS);
  const isWriting = (WRITING_TASKS as readonly string[]).includes(task);
  if (!isWriting && task !== "search") {
    return Response.json({ error: "Unknown task" }, { status: 400 });
  }
  if (task !== "draft" && !text.trim()) {
    return Response.json({ error: "Nothing to work on" }, { status: 400 });
  }

  let system: string;
  let prompt: string;
  let accountIds: string[] = [];
  if (task === "search") {
    const accounts = (await readableMailAccounts(userId, request)).filter((a) => !a.archived);
    accountIds = accounts.map((a) => a.id);
    system = searchSystemPrompt(
      new Date().toISOString().slice(0, 10),
      accounts.map((a) => ({ id: a.id, label: `${mailAccountLabel(a)} <${a.address}>` })),
    );
    prompt = text;
  } else {
    let thread: string | undefined;
    const accountId = str(b.accountId);
    const threadId = str(b.threadId);
    if (accountId && threadId) {
      const account = await findReadableAccount(userId, accountId, request);
      if (!account) return Response.json({ error: "Not found" }, { status: 404 });
      try {
        thread = threadToContext(await getThread(await getMailboxToken(account), threadId));
      } catch (err) {
        if (!(err instanceof MailboxError)) throw err;
        return Response.json({ error: "Couldn't read this thread from Gmail." }, { status: 502 });
      }
    }
    system = writingSystemPrompt(task as WritingTask, str(b.language).slice(0, 60));
    prompt = writingUserPrompt({
      task: task as WritingTask,
      text,
      instruction: str(b.instruction).slice(0, 2000),
      thread,
    });
  }

  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > AI_DAILY_MAX) {
    return Response.json(
      { error: `You've reached today's AI limit (${AI_DAILY_MAX} requests). It resets at midnight UTC.` },
      { status: 429, headers: { "Retry-After": String(secondsToUtcMidnight()) } },
    );
  }

  try {
    const result = await generateShortText({ system, prompt, maxTokens: 1500 });
    if (!result) return Response.json({ error: "AI is not configured" }, { status: 503 });
    await recordTokenUsage(userId, day, result.inputTokens, result.outputTokens);

    if (task === "search") {
      const parsed = parseSearchResponse(result.text, accountIds);
      return Response.json(parsed ?? { query: text, accounts: [] });
    }
    return Response.json({ text: result.text });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: "AI service error" }, { status: 502 });
    }
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }
}
