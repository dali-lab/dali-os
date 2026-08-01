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
