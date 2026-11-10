// NEVER log the question, the answer, or tool output.

import type { Route } from "./+types/api.ask";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { resolveAiProvider } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { aiQuotaResponse, ASK_DAILY_MAX, claimAskQuota, releaseAskQuota } from "~/lib/ai-quota.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { validateHistory } from "~/lib/ai-history";
import { runAsk, type AskEvent } from "~/ask/loop.server";

export const ASK_QUESTION_MAX = 2000;
const BURST_MAX = 10;
const BURST_WINDOW_MS = 60_000;

const encoder = new TextEncoder();

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;

  const roles = await getUserRoles(userId, request);
  if (!roles.isLabMember || !(await isFeatureEnabled("ask-dali", userId, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  const burst = checkRateLimit(request, { max: BURST_MAX, windowMs: BURST_WINDOW_MS }, `ask:${userId}`);
  if (burst) {
    const retryAfter = burst.headers.get("Retry-After") ?? "60";
    return Response.json(
      { error: `You're asking too quickly. Try again in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": retryAfter } },
    );
  }

  const provider = resolveAiProvider();
  if (!provider) return Response.json({ error: "Ask isn't set up yet." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (!question) return Response.json({ error: "Ask a question first." }, { status: 400 });
  if (question.length > ASK_QUESTION_MAX) {
    return Response.json({ error: `Keep questions under ${ASK_QUESTION_MAX} characters.` }, { status: 400 });
  }
  const history = validateHistory(b.history);
  if (!history.ok) return Response.json({ error: history.message }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, daliEmail: true, dartmouthEmail: true, netId: true, firstName: true, lastName: true },
  });
  if (!user) return Response.json({ error: "Not available" }, { status: 403 });

  const quota = await claimAskQuota(userId);
  if (!quota.ok) return aiQuotaResponse(quota);

  const readable = new ReadableStream({
    async start(controller) {
      const emit = (event: AskEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected.
        }
      };
      const usage = { inputTokens: 0, outputTokens: 0 };
      try {
        await runAsk({
          provider,
          caller: {
            user,
            scopes: ["mcp:read"],
            request,
            origin: "ask",
            clientId: "ask-dali",
            clientName: "Ask DALI",
            grantId: null,
          },
          question,
          history: history.entries,
          emit,
          signal: request.signal,
          usage,
        });
      } catch {
        if (!request.signal.aborted) {
          emit({ type: "error", message: "Something went wrong. Try again." });
          await releaseAskQuota(userId, quota.day);
        }
      } finally {
        await recordTokenUsage(userId, quota.day, usage.inputTokens, usage.outputTokens);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "X-Ask-Remaining": String(Math.max(0, ASK_DAILY_MAX - quota.used)),
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
