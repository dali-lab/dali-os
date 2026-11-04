// AI provider and model registry. Every AI call resolves its model through
// modelParams(provider, task); add a task to AI_TASKS rather than naming a
// model at a call site.
//
// Env:
//   ANTHROPIC_API_KEY       — first-party Anthropic API.
//   DARTMOUTH_CHAT_API_KEY  — Dartmouth Chat gateway (Anthropic-Messages-compatible,
//                             same SDK with a baseURL override and a bearer token).
//   DARTMOUTH_CHAT_BASE_URL — defaults to https://chat.dartmouth.edu/api.
//   AI_PROVIDER             — "anthropic" or "dartmouth" to force one; otherwise
//                             Anthropic wins when both keys are set.

import Anthropic from "@anthropic-ai/sdk";

export type AiProviderName = "anthropic" | "dartmouth";

export interface AiProvider {
  name: AiProviderName;
  client: Anthropic;
}

export type AiTask =
  | "doc"
  | "ask"
  | "enhance"
  | "meetingNotes"
  | "email"
  | "resumeExtract"
  | "releaseNotes"
  | "projectTldr";

type ModelTier = "sonnet" | "haiku";
type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

export const AI_TASKS: Record<AiTask, { tier: ModelTier; effort?: Effort }> = {
  doc: { tier: "sonnet" },
  ask: { tier: "sonnet", effort: "medium" },
  enhance: { tier: "sonnet", effort: "medium" },
  resumeExtract: { tier: "sonnet", effort: "low" },
  meetingNotes: { tier: "sonnet", effort: "low" },
  email: { tier: "sonnet", effort: "low" },
  releaseNotes: { tier: "sonnet", effort: "low" },
  projectTldr: { tier: "haiku", effort: "low" },
};

export const AI_MODELS: Record<AiProviderName, Record<ModelTier, string>> = {
  anthropic: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
  dartmouth: { sonnet: "anthropic.claude-sonnet-5-5", haiku: "anthropic.claude-haiku-4-5-20251001" },
};

const DARTMOUTH_DEFAULT_BASE_URL = "https://chat.dartmouth.edu/api";

function resolveAiProviderName(): AiProviderName | null {
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasDartmouth = Boolean(process.env.DARTMOUTH_CHAT_API_KEY);
  const forced = process.env.AI_PROVIDER;
  if (forced === "dartmouth") return hasDartmouth ? "dartmouth" : null;
  if (forced === "anthropic") return hasAnthropic ? "anthropic" : null;
  if (hasAnthropic) return "anthropic";
  return hasDartmouth ? "dartmouth" : null;
}

export function resolveAiProvider(): AiProvider | null {
  const name = resolveAiProviderName();
  if (name === "anthropic") return { name, client: new Anthropic() };
  if (name === "dartmouth") {
    return {
      name,
      client: new Anthropic({
        baseURL: process.env.DARTMOUTH_CHAT_BASE_URL ?? DARTMOUTH_DEFAULT_BASE_URL,
        // apiKey: null stops the SDK reading ANTHROPIC_API_KEY too; the gateway rejects both headers.
        apiKey: null,
        authToken: process.env.DARTMOUTH_CHAT_API_KEY,
      }),
    };
  }
  return null;
}

export function isAiEnabled(): boolean {
  return resolveAiProviderName() !== null;
}

/** Effort only goes to first-party Anthropic; the gateway's support for output_config is unverified. */
export function modelParams(
  provider: Pick<AiProvider, "name">,
  task: AiTask,
): { model: string; output_config?: { effort: Effort } } {
  const { tier, effort } = AI_TASKS[task];
  const model = AI_MODELS[provider.name][tier];
  return effort && provider.name === "anthropic" ? { model, output_config: { effort } } : { model };
}

/**
 * One-shot, non-streaming completion for small server-side generations.
 * Returns null when no provider is configured. The caller owns rate limiting,
 * the daily-quota upsert, and recordTokenUsage.
 */
export async function generateShortText(opts: {
  task: AiTask;
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number; stopReason?: string | null } | null> {
  const provider = resolveAiProvider();
  if (!provider) return null;

  const message = await provider.client.messages.create({
    ...modelParams(provider, opts.task),
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
    stopReason: message.stop_reason,
  };
}

export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed) ?? "";
}
