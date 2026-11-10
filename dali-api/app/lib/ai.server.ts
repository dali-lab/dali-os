// AI provider and model registry. Every AI call resolves its model through
// modelParams(provider, task); add a task to AI_TASKS rather than naming a
// model at a call site.
//
// Env:
//   ANTHROPIC_API_KEY       — first-party Anthropic API.
//   DARTMOUTH_CHAT_API_KEY  — Dartmouth Chat gateway (Anthropic-Messages-compatible,
//                             same SDK with a baseURL override and a bearer token).
//   DARTMOUTH_CHAT_BASE_URL — defaults to https://chat.dartmouth.edu/api.
//   AI_PROVIDER             — "anthropic" or "dartmouth" to force one for every task.
//
// With both keys, a task runs on Anthropic unless AI_TASKS gives it `prefer`;
// generateShortText then falls back to the other provider when the first fails.

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

export const AI_TASKS: Record<AiTask, { tier: ModelTier; effort?: Effort; prefer?: AiProviderName }> = {
  doc: { tier: "sonnet" },
  ask: { tier: "sonnet", effort: "medium" },
  enhance: { tier: "sonnet", effort: "medium", prefer: "dartmouth" },
  resumeExtract: { tier: "sonnet", effort: "low" },
  meetingNotes: { tier: "sonnet", effort: "low" },
  email: { tier: "sonnet", effort: "low", prefer: "dartmouth" },
  releaseNotes: { tier: "sonnet", effort: "low", prefer: "dartmouth" },
  projectTldr: { tier: "haiku", effort: "low", prefer: "dartmouth" },
};

export const AI_MODELS: Record<AiProviderName, Record<ModelTier, string>> = {
  anthropic: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
  dartmouth: { sonnet: "anthropic.claude-sonnet-5-5", haiku: "anthropic.claude-haiku-4-5-20251001" },
};

const DARTMOUTH_DEFAULT_BASE_URL = "https://chat.dartmouth.edu/api";

function availableProviderNames(): AiProviderName[] {
  const has: Record<AiProviderName, boolean> = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    dartmouth: Boolean(process.env.DARTMOUTH_CHAT_API_KEY),
  };
  const forced = process.env.AI_PROVIDER;
  if (forced === "anthropic" || forced === "dartmouth") return has[forced] ? [forced] : [];
  return (["anthropic", "dartmouth"] as const).filter((n) => has[n]);
}

function makeProvider(name: AiProviderName): AiProvider {
  if (name === "anthropic") return { name, client: new Anthropic() };
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

export function resolveAiProvider(): AiProvider | null {
  const [name] = availableProviderNames();
  return name ? makeProvider(name) : null;
}

/** The task's providers in the order to try them: its `prefer` first when that key is set. */
export function aiProvidersFor(task: AiTask): AiProvider[] {
  const names = availableProviderNames();
  const prefer = AI_TASKS[task].prefer;
  const ordered = prefer && names.includes(prefer) ? [prefer, ...names.filter((n) => n !== prefer)] : names;
  return ordered.map(makeProvider);
}

export function isAiEnabled(): boolean {
  return availableProviderNames().length > 0;
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

export type ShortText = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string | null;
};

const FALLBACK_ATTEMPT_TIMEOUT_MS = 180_000;

/**
 * One-shot, non-streaming completion for small server-side generations.
 * Returns null when no provider is configured. Tries the task's providers in
 * order: a provider that throws, stops at its token cap, or whose result
 * `accept` rejects hands off to the next; the last one's result or error is final. The caller owns rate
 * limiting, the daily-quota upsert, and recordTokenUsage.
 */
export async function generateShortText(opts: {
  task: AiTask;
  system: string;
  prompt: string;
  maxTokens?: number;
  accept?: (result: ShortText) => boolean;
}): Promise<ShortText | null> {
  const providers = aiProvidersFor(opts.task);
  for (const [i, provider] of providers.entries()) {
    const hasNext = i < providers.length - 1;
    try {
      const message = await provider.client.messages.create(
        {
          ...modelParams(provider, opts.task),
          max_tokens: opts.maxTokens ?? 512,
          system: opts.system,
          messages: [{ role: "user", content: opts.prompt }],
          stream: false,
        },
        hasNext ? { maxRetries: 0, timeout: FALLBACK_ATTEMPT_TIMEOUT_MS } : undefined,
      );
      const result: ShortText = {
        text: message.content
          .filter((block) => block.type === "text")
          .map((block) => (block as { type: "text"; text: string }).text)
          .join("\n")
          .trim(),
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        stopReason: message.stop_reason,
      };
      const usable = result.stopReason !== "max_tokens" && (opts.accept?.(result) ?? true);
      if (!hasNext || usable) return result;
      console.warn(`[ai] ${opts.task} on ${provider.name} returned an unusable result, trying the next provider`);
    } catch (err) {
      if (!hasNext) throw err;
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      console.warn(`[ai] ${opts.task} on ${provider.name} failed (${status ?? "no status"}), trying the next provider`);
    }
  }
  return null;
}

export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed) ?? "";
}
