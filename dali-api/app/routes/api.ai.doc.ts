// POST /api/ai/doc — AI document-writing assistant for the BlockNote editor.
// Requires an authenticated member session. Returns 503 when
// ANTHROPIC_API_KEY is not configured (feature hidden client-side when that
// happens, so 503 is a defence-in-depth signal, not a normal path).
//
// NEVER log the API key, JWT, cookies, or full document content.
// NEVER include temperature/top_p/top_k — they 400 on this model.
// NEVER prefill the assistant turn — it 400s too.

import type { Route } from "./+types/api.ai.doc";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";

export type AiDocAction = "prompt" | "improve" | "fix" | "summarize" | "continue";

export interface AiDocRequest {
  action: AiDocAction;
  instruction?: string; // required for "prompt", optional hint for others
  context: string; // markdown text (capped by the client)
}

export interface AiDocResponse {
  markdown: string;
}

export interface AiDocDisabledResponse {
  aiEnabled: false;
}

const ACTIONS: Set<string> = new Set([
  "prompt",
  "improve",
  "fix",
  "summarize",
  "continue",
]);

const SYSTEM_PROMPT = `You are a concise, helpful writing assistant embedded in a lab-management platform. \
You help lab members write, improve, and structure documents. \
Always respond with ONLY the resulting markdown content — no preamble, no explanation, no surrounding code fences. \
Produce clean, readable prose appropriate for a professional lab context.`;

function buildUserMessage(req: AiDocRequest): string {
  switch (req.action) {
    case "prompt":
      return `${req.instruction ?? "Continue writing"}\n\nContext (existing document):\n${req.context}`;
    case "continue":
      return `Continue writing from where this document left off. Return only the new content to append.\n\nDocument so far:\n${req.context}`;
    case "improve":
      return `Improve the writing quality, clarity, and flow of the following text. Return only the improved version.\n\nText:\n${req.context}`;
    case "fix":
      return `Fix all spelling and grammar errors in the following text. Return only the corrected version.\n\nText:\n${req.context}`;
    case "summarize":
      return `Write a concise summary of the following document. Return only the summary.\n\nDocument:\n${req.context}`;
  }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
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

  const action = b.action;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  const context = b.context;
  if (typeof context !== "string") {
    return Response.json({ error: "context must be a string" }, { status: 400 });
  }

  const instruction =
    typeof b.instruction === "string" ? b.instruction : undefined;

  if (action === "prompt" && !instruction) {
    return Response.json(
      { error: "instruction is required for prompt action" },
      { status: 400 },
    );
  }

  const req: AiDocRequest = {
    action: action as AiDocAction,
    instruction,
    // Context is already capped client-side; we enforce a hard server cap too.
    context: context.slice(0, 8000),
  };

  const client = new Anthropic();

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(req) }],
    });

    // Extract text content from the response (skip thinking blocks).
    const textContent = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");

    return Response.json({ markdown: textContent } satisfies AiDocResponse);
  } catch (err) {
    // Use the SDK's typed error class — never string-match error messages.
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? 502;
      // 4xx from Anthropic = our bug (bad request shape). Map to 502 for the
      // client so it shows "AI unavailable" rather than leaking details.
      return Response.json(
        { error: "AI service error", code: status },
        { status: 502 },
      );
    }
    // Unexpected non-API error (network, timeout, etc.)
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }
}
