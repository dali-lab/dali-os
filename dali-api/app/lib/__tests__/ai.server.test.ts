import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends actual.default {
    constructor(opts?: ConstructorParameters<typeof actual.default>[0]) {
      super(opts);
      (this.messages as unknown as { create: typeof create }).create = create;
    }
  }
  return { ...actual, default: FakeAnthropic };
});

import {
  AI_MODELS,
  AI_TASKS,
  generateShortText,
  isAiEnabled,
  modelParams,
  resolveAiProvider,
  type AiTask,
} from "~/lib/ai.server";

const ENV_KEYS = ["ANTHROPIC_API_KEY", "DARTMOUTH_CHAT_API_KEY", "DARTMOUTH_CHAT_BASE_URL", "AI_PROVIDER"] as const;
const TASKS = Object.keys(AI_TASKS) as AiTask[];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  create.mockReset();
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveAiProvider", () => {
  it("returns null when no key is configured", () => {
    expect(resolveAiProvider()).toBeNull();
    expect(isAiEnabled()).toBe(false);
  });

  it("uses first-party Anthropic when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(resolveAiProvider()?.name).toBe("anthropic");
    expect(isAiEnabled()).toBe(true);
  });

  it("uses Dartmouth at the default base URL when only DARTMOUTH_CHAT_API_KEY is set", () => {
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    const p = resolveAiProvider();
    expect(p?.name).toBe("dartmouth");
    expect(p?.client.baseURL).toBe("https://chat.dartmouth.edu/api");
    expect(isAiEnabled()).toBe(true);
  });

  it("honors DARTMOUTH_CHAT_BASE_URL", () => {
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    process.env.DARTMOUTH_CHAT_BASE_URL = "https://chat.example.edu/api";
    expect(resolveAiProvider()?.client.baseURL).toBe("https://chat.example.edu/api");
  });

  it("prefers first-party Anthropic when both keys are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    expect(resolveAiProvider()?.name).toBe("anthropic");
  });

  it("AI_PROVIDER=dartmouth forces the gateway over first-party", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    process.env.AI_PROVIDER = "dartmouth";
    expect(resolveAiProvider()?.name).toBe("dartmouth");
  });

  it("AI_PROVIDER=anthropic forces first-party", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    process.env.AI_PROVIDER = "anthropic";
    expect(resolveAiProvider()?.name).toBe("anthropic");
  });

  it("a forced provider without its key disables AI instead of falling back", () => {
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    process.env.AI_PROVIDER = "anthropic";
    expect(resolveAiProvider()).toBeNull();
    expect(isAiEnabled()).toBe(false);

    delete process.env.DARTMOUTH_CHAT_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AI_PROVIDER = "dartmouth";
    expect(resolveAiProvider()).toBeNull();
  });
});

describe("modelParams", () => {
  it("runs the TL;DR on Haiku and every other task on Sonnet", () => {
    for (const task of TASKS) {
      expect(modelParams({ name: "anthropic" }, task).model).toBe(
        task === "projectTldr" ? "claude-haiku-5-5" : "claude-sonnet-5-5",
      );
    }
  });

  it("maps each tier to the gateway's catalog ids on Dartmouth", () => {
    expect(modelParams({ name: "dartmouth" }, "enhance").model).toBe("anthropic.claude-sonnet-5-5");
    expect(modelParams({ name: "dartmouth" }, "projectTldr").model).toBe("anthropic.claude-haiku-4-5-20251001");
  });

  it("never resolves a task to an Opus model", () => {
    for (const ids of Object.values(AI_MODELS)) {
      for (const id of Object.values(ids)) expect(id).not.toMatch(/opus/);
    }
  });

  it("sends each task's effort to first-party Anthropic", () => {
    expect(modelParams({ name: "anthropic" }, "enhance").output_config).toEqual({ effort: "medium" });
    expect(modelParams({ name: "anthropic" }, "ask").output_config).toEqual({ effort: "medium" });
    expect(modelParams({ name: "anthropic" }, "projectTldr").output_config).toEqual({ effort: "low" });
    expect(modelParams({ name: "anthropic" }, "doc").output_config).toBeUndefined();
  });

  it("never sends effort to the Dartmouth gateway", () => {
    for (const task of TASKS) {
      expect(modelParams({ name: "dartmouth" }, task)).not.toHaveProperty("output_config");
    }
  });
});

describe("generateShortText", () => {
  it("returns null without a provider", async () => {
    expect(await generateShortText({ task: "email", system: "s", prompt: "p" })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("sends the task's model and effort and returns text, usage and stop reason", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    create.mockResolvedValue({
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: " Hello " },
      ],
      usage: { input_tokens: 12, output_tokens: 3 },
      stop_reason: "end_turn",
    });

    const result = await generateShortText({ task: "projectTldr", system: "sys", prompt: "facts", maxTokens: 400 });

    expect(create).toHaveBeenCalledWith({
      model: "claude-haiku-5-5",
      output_config: { effort: "low" },
      max_tokens: 400,
      system: "sys",
      messages: [{ role: "user", content: "facts" }],
      stream: false,
    });
    expect(result).toEqual({ text: "Hello", inputTokens: 12, outputTokens: 3, stopReason: "end_turn" });
  });
});
