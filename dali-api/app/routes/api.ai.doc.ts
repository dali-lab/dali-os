// POST /api/ai/doc — AI document-writing assistant for the BlockNote editor.
// Requires an authenticated member session. Returns 503 when no AI provider
// is configured (feature hidden client-side when that happens, so 503 is a
// defence-in-depth signal, not a normal path). Provider selection — first-party
// Anthropic vs the Dartmouth Chat gateway — lives in ~/lib/ai.server.
//
// NEVER log the API key, JWT, cookies, or full document content.
// NEVER include temperature/top_p/top_k — they 400 on first-party models.
// NEVER prefill the assistant turn — it 400s too.

import type { Route } from "./+types/api.ai.doc";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";
import { resolveAiProvider } from "~/lib/ai.server";

// ── Deprecated: kept for client-side components that import AiDocAction until
// Stage 2 rewrites them. Remove when AiPanel / AiSlashMenuItems are rewritten.
export type AiDocAction = "prompt" | "improve" | "fix" | "summarize" | "continue";

// ── New contract ──────────────────────────────────────────────────────────────

export interface AiHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface AiDocRequest {
  instruction: string;
  context?: string;
  history?: AiHistoryEntry[];
  stream?: boolean;
}

export interface AiDocResponse {
  markdown: string;
}

export interface AiDocDisabledResponse {
  aiEnabled: false;
}

// ── Caps ──────────────────────────────────────────────────────────────────────

const INSTRUCTION_MAX = 4000;
const CONTEXT_MAX = 8000;
const HISTORY_ENTRY_MAX = 8000;
const HISTORY_ENTRIES_MAX = 12;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a concise, helpful writing assistant embedded in a lab-management platform. \
You help lab members write, improve, and structure documents. \
Always respond with ONLY the resulting markdown content — no preamble, no explanation, no surrounding code fences. \
Produce clean, readable prose appropriate for a professional lab context. \
You may receive follow-up refinement requests in a conversation; always return the full replacement markdown, not a diff.`;

// ── History validator (exported for unit tests) ───────────────────────────────

export interface HistoryValidationError {
  ok: false;
  message: string;
}

export interface HistoryValidationOk {
  ok: true;
  entries: AiHistoryEntry[];
}

/**
 * Validates and caps the history array.
 * Rules enforced:
 *   - Must be an array (if provided)
 *   - Max HISTORY_ENTRIES_MAX entries
 *   - Each entry must have role "user" | "assistant" and a string content
 *   - Must start with a "user" entry
 *   - Roles must strictly alternate (user, assistant, user, assistant, …)
 *   - Each content capped at HISTORY_ENTRY_MAX chars
 */
export function validateHistory(
  raw: unknown,
): HistoryValidationOk | HistoryValidationError {
  if (raw === undefined || raw === null) {
    return { ok: true, entries: [] };
  }

  if (!Array.isArray(raw)) {
    return { ok: false, message: "history must be an array" };
  }

  if (raw.length > HISTORY_ENTRIES_MAX) {
    return {
      ok: false,
      message: `history must not exceed ${HISTORY_ENTRIES_MAX} entries`,
    };
  }

  const entries: AiHistoryEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown>;
    if (!entry || typeof entry !== "object") {
      return { ok: false, message: `history[${i}] must be an object` };
    }
    if (entry.role !== "user" && entry.role !== "assistant") {
      return {
        ok: false,
        message: `history[${i}].role must be "user" or "assistant"`,
      };
    }
    if (typeof entry.content !== "string") {
      return {
        ok: false,
        message: `history[${i}].content must be a string`,
      };
    }

    const expectedRole = i % 2 === 0 ? "user" : "assistant";
    if (entry.role !== expectedRole) {
      if (i === 0) {
        return {
          ok: false,
          message: "history must start with a user entry",
        };
      }
      return {
        ok: false,
        message: `history roles must alternate; expected "${expectedRole}" at index ${i}, got "${entry.role}"`,
      };
    }

    entries.push({
      role: entry.role as "user" | "assistant",
      content: (entry.content as string).slice(0, HISTORY_ENTRY_MAX),
    });
  }

  return { ok: true, entries };
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseData(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Route action ──────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const provider = resolveAiProvider();
  if (!provider) {
    return Response.json({ aiEnabled: false } satisfies AiDocDisabledResponse, {
      status: 503,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  if (!b || typeof b !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── instruction (required) ────────────────────────────────────────────────
  if (typeof b.instruction !== "string" || !b.instruction.trim()) {
    return Response.json(
      { error: "instruction is required and must be a non-empty string" },
      { status: 400 },
    );
  }
  const instruction = b.instruction.trim().slice(0, INSTRUCTION_MAX);

  // ── context (optional) ────────────────────────────────────────────────────
  const context =
    typeof b.context === "string"
      ? b.context.slice(0, CONTEXT_MAX)
      : undefined;

  // ── history (optional) ────────────────────────────────────────────────────
  const historyResult = validateHistory(b.history);
  if (!historyResult.ok) {
    return Response.json({ error: historyResult.message }, { status: 400 });
  }
  const history = historyResult.entries;

  // ── stream flag ───────────────────────────────────────────────────────────
  const wantStream = Boolean(b.stream);

  // ── Build messages array ──────────────────────────────────────────────────
  const userMessage = context
    ? `${instruction}\n\nContext (document excerpt):\n${context}`
    : instruction;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: userMessage },
  ];

  // ── Shared create params ──────────────────────────────────────────────────
  const createParams = {
    model: provider.model,
    max_tokens: 8192,
    // Adaptive thinking only on first-party Claude — the Dartmouth gateway's
    // Bedrock-style model ids may reject the param.
    ...(provider.adaptiveThinking
      ? { thinking: { type: "adaptive" as const } }
      : {}),
    system: SYSTEM_PROMPT,
    messages,
  };

  // ── Non-streaming path ────────────────────────────────────────────────────
  if (!wantStream) {
    try {
      const message = await provider.client.messages.create({
        ...createParams,
        stream: false,
      });

      // Extract text content (skip thinking blocks).
      const textContent = message.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { type: "text"; text: string }).text)
        .join("\n");

      return Response.json({ markdown: textContent } satisfies AiDocResponse);
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        return Response.json(
          { error: "AI service error", code: err.status ?? 502 },
          { status: 502 },
        );
      }
      return Response.json({ error: "AI request failed" }, { status: 502 });
    }
  }

  // ── Streaming path ────────────────────────────────────────────────────────
  //
  // Uses provider.client.messages.stream() — the SDK helper that returns a
  // MessageStream supporting async iteration and .abort(). This is the method
  // returned by client.messages.stream(...) per the SDK source.
  //
  // Resilience fallback: if stream() itself throws (e.g. Dartmouth gateway
  // rejects streaming), we catch and fall back to a single non-streaming
  // create, emitting one delta + done — the client sees a valid SSE response
  // regardless of which path ran.
  //
  // Abort: request.signal fires when the client disconnects; we forward it
  // to the SDK stream via sdkStream.abort().

  const readable = new ReadableStream({
    async start(controller) {
      const enqueue = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(sseData(payload));
        } catch {
          // Controller already closed (client disconnected).
        }
      };

      // Wire up client-disconnect → SDK abort.
      let sdkStream: Awaited<ReturnType<typeof provider.client.messages.stream>> | null = null;

      const onAbort = () => {
        sdkStream?.abort();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", onAbort);

      try {
        sdkStream = provider.client.messages.stream(createParams);

        for await (const event of sdkStream) {
          if (request.signal.aborted) break;

          // Only emit text_delta events; skip thinking_delta and others.
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            enqueue({ delta: event.delta.text });
          }
        }

        if (!request.signal.aborted) {
          enqueue({ done: true });
        }
      } catch (streamErr) {
        if (request.signal.aborted) {
          // Client disconnected — close silently.
          try {
            controller.close();
          } catch {
            // already closed
          }
          request.signal.removeEventListener("abort", onAbort);
          return;
        }

        // Resilience fallback: try a non-streaming create and emit as one delta.
        try {
          const fallbackMsg = await provider.client.messages.create({
            ...createParams,
            stream: false,
          });
          const text = fallbackMsg.content
            .filter((block) => block.type === "text")
            .map((block) => (block as { type: "text"; text: string }).text)
            .join("\n");
          enqueue({ delta: text });
          enqueue({ done: true });
        } catch (fallbackErr) {
          const msg =
            fallbackErr instanceof Anthropic.APIError
              ? "AI service error"
              : "AI request failed";
          enqueue({ error: msg });
        }
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // ReadableStream cancel fires when the consumer (response body) is cancelled.
      // The abort listener above already handles SDK abort; this is a belt-and-suspenders.
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
