import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends actual.default {
    constructor(opts?: ConstructorParameters<typeof actual.default>[0]) {
      super(opts);
      (this.messages as unknown as { create: unknown }).create = (params: unknown, options: unknown) =>
        create(params, options, this.baseURL);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

import {
  AI_MODELS,
  AI_TASKS,
  aiProvidersFor,
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

  it("sends the task's model and effort and returns text, usage, stop reason and provider", async () => {
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

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      model: "claude-haiku-5-5",
      output_config: { effort: "low" },
      max_tokens: 400,
      system: "sys",
      messages: [{ role: "user", content: "facts" }],
      stream: false,
    });
    expect(create.mock.calls[0][1]).toBeUndefined();
    expect(result).toEqual({ text: "Hello", inputTokens: 12, outputTokens: 3, stopReason: "end_turn" });
  });
});

const GATEWAY = "https://chat.dartmouth.edu/api";
const reply = (text: string, stop = "end_turn") => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 5, output_tokens: 2 },
  stop_reason: stop,
});

describe("aiProvidersFor", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
  });

  it("tries the gateway first for enhance, email, release notes and the TL;DR", () => {
    for (const task of ["enhance", "email", "releaseNotes", "projectTldr"] as const) {
      expect(aiProvidersFor(task).map((p) => p.name)).toEqual(["dartmouth", "anthropic"]);
    }
  });

  it("keeps Ask DALI and the other tasks on Anthropic first", () => {
    for (const task of ["ask", "doc", "meetingNotes", "resumeExtract"] as const) {
      expect(aiProvidersFor(task).map((p) => p.name)).toEqual(["anthropic", "dartmouth"]);
    }
  });

  it("uses only the provider that has a key", () => {
    delete process.env.DARTMOUTH_CHAT_API_KEY;
    expect(aiProvidersFor("enhance").map((p) => p.name)).toEqual(["anthropic"]);
  });

  it("uses only the forced provider", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(aiProvidersFor("enhance").map((p) => p.name)).toEqual(["anthropic"]);
  });
});

describe("generateShortText fallback", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const call = (opts: Partial<Parameters<typeof generateShortText>[0]> = {}) =>
    generateShortText({ task: "enhance", system: "s", prompt: "p", maxTokens: 100, ...opts });

  it("returns the gateway's result without calling Anthropic", async () => {
    create.mockResolvedValueOnce(reply("from gateway"));
    const result = await call();
    expect(result).toMatchObject({ text: "from gateway" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][2]).toBe(GATEWAY);
  });

  it("gives the gateway attempt no retries and a bounded timeout", async () => {
    create.mockResolvedValueOnce(reply("ok"));
    await call();
    expect(create.mock.calls[0][1]).toEqual({ maxRetries: 0, timeout: 180_000 });
  });

  it("switches to Anthropic when the gateway throws", async () => {
    create.mockRejectedValueOnce(new Error("rate limited")).mockResolvedValueOnce(reply("from anthropic"));
    const result = await call();
    expect(result).toMatchObject({ text: "from anthropic" });
    expect(create.mock.calls[1][2]).not.toBe(GATEWAY);
    expect(create.mock.calls[1][0]).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "medium" } });
    expect(create.mock.calls[1][1]).toBeUndefined();
  });

  it("switches to Anthropic when the gateway stops at its token cap", async () => {
    create.mockResolvedValueOnce(reply("{\"half", "max_tokens")).mockResolvedValueOnce(reply("whole"));
    expect(await call()).toMatchObject({ text: "whole" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("switches to Anthropic when accept rejects the gateway's result", async () => {
    create.mockResolvedValueOnce(reply("not json")).mockResolvedValueOnce(reply("{}"));
    const accept = vi.fn((r: { text: string }) => r.text === "{}");
    expect(await call({ accept })).toMatchObject({ text: "{}" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("returns the last provider's result even when accept rejects it", async () => {
    create.mockResolvedValueOnce(reply("bad")).mockResolvedValueOnce(reply("also bad", "max_tokens"));
    expect(await call({ accept: () => false })).toMatchObject({ text: "also bad", stopReason: "max_tokens" });
  });

  it("throws the last provider's error when both fail", async () => {
    create.mockRejectedValueOnce(new Error("gateway down")).mockRejectedValueOnce(new Error("anthropic down"));
    await expect(call()).rejects.toThrow("anthropic down");
  });

  it("falls back to the gateway when Anthropic fails for an Anthropic-first task", async () => {
    create.mockRejectedValueOnce(new Error("anthropic down")).mockResolvedValueOnce(reply("from gateway"));
    const result = await call({ task: "meetingNotes" });
    expect(result).toMatchObject({ text: "from gateway" });
    expect(create.mock.calls[0][2]).not.toBe(GATEWAY);
    expect(create.mock.calls[1][2]).toBe(GATEWAY);
  });
});
