// AI provider resolution for the doc assistant (/api/ai/doc).
//
// Two ways to enable AI — both drive the SAME Anthropic Messages code path:
//   1. ANTHROPIC_API_KEY        — first-party Anthropic API.
//   2. DARTMOUTH_CHAT_API_KEY   — Dartmouth Chat (chat.dartmouth.edu), whose
//      API is Anthropic-Messages-compatible; we point the same SDK at it with
//      a baseURL override and a bearer token.
//
// Precedence: ANTHROPIC_API_KEY wins when both are set, unless
// AI_PROVIDER=dartmouth forces the Dartmouth gateway.
//
// Optional Dartmouth knobs:
//   DARTMOUTH_CHAT_BASE_URL — defaults to https://chat.dartmouth.edu/api
//   DARTMOUTH_CHAT_MODEL    — defaults to a known-good Claude id; list the
//                             current catalog with GET {base}/models
//                             (Authorization: bearer <key>).

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "~/lib/db";

export type AiProviderName = "anthropic" | "dartmouth";

export interface AiProvider {
  name: AiProviderName;
  client: Anthropic;
  model: string;
  /** First-party Claude supports adaptive thinking. The Dartmouth gateway
   * serves Bedrock-style model ids (anthropic.claude-…) that may predate or
   * reject the thinking param — skip it there. */
  adaptiveThinking: boolean;
}

const DARTMOUTH_DEFAULT_BASE_URL = "https://chat.dartmouth.edu/api";
const DARTMOUTH_DEFAULT_MODEL = "anthropic.claude-haiku-4-5-20251001";

export function resolveAiProvider(): AiProvider | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const dartmouthKey = process.env.DARTMOUTH_CHAT_API_KEY;

  const useDartmouth =
    Boolean(dartmouthKey) &&
    (process.env.AI_PROVIDER === "dartmouth" || !anthropicKey);

  if (useDartmouth) {
    return {
      name: "dartmouth",
      client: new Anthropic({
        baseURL: process.env.DARTMOUTH_CHAT_BASE_URL ?? DARTMOUTH_DEFAULT_BASE_URL,
        // apiKey: null stops the SDK from also reading ANTHROPIC_API_KEY from
        // the env — sending both x-api-key and Authorization gets rejected.
        apiKey: null,
        authToken: dartmouthKey, // sent as Authorization: Bearer <key>
      }),
      model: process.env.DARTMOUTH_CHAT_MODEL ?? DARTMOUTH_DEFAULT_MODEL,
      adaptiveThinking: false,
    };
  }

  if (anthropicKey) {
    return {
      name: "anthropic",
      client: new Anthropic(),
      model: "claude-opus-4-8",
      adaptiveThinking: true,
    };
  }

  return null;
}

/** Loader-side gate: true when any AI provider key is configured. */
export function isAiEnabled(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.DARTMOUTH_CHAT_API_KEY,
  );
}

/**
 * Best-effort token accounting on the caller's AiUsage row (created by the
 * daily-quota upsert earlier in the same request). Never throws — a failed
 * write must not break an otherwise successful AI response. Shared by every
 * AI route (/api/ai/doc, /api/ai/project-tldr). Exported for unit tests.
 */
export async function recordTokenUsage(
  userId: string,
  day: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (inputTokens <= 0 && outputTokens <= 0) return;
  try {
    await prisma.aiUsage.update({
      where: { userId_day: { userId, day } },
      data: {
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
      },
    });
  } catch {
    // Telemetry only.
  }
}

/**
 * One-shot, non-streaming completion for small server-side summaries (e.g. the
 * project TL;DR). Resolves the same provider as the doc assistant and returns
 * the text plus token usage for the caller to record; null when no provider is
 * configured. No extended thinking — these are short, factual generations where
 * the thinking budget would only add latency and cost.
 *
 * The caller owns rate limiting, the daily-quota upsert, and recordTokenUsage —
 * this stays a thin "call the model" utility so both AI routes share it.
 */
export async function generateShortText(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
  const provider = resolveAiProvider();
  if (!provider) return null;

  const message = await provider.client.messages.create({
    model: provider.model,
    max_tokens: opts.maxTokens ?? 512,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    stream: false,
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  return {
    text,
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}
