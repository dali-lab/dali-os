// Provider resolution for the doc AI assistant — precedence and config.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAiProvider, isAiEnabled } from "~/lib/ai.server";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "DARTMOUTH_CHAT_API_KEY",
  "DARTMOUTH_CHAT_BASE_URL",
  "DARTMOUTH_CHAT_MODEL",
  "AI_PROVIDER",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
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
    const p = resolveAiProvider();
    expect(p?.name).toBe("anthropic");
    expect(p?.model).toBe("claude-opus-4-8");
    expect(p?.adaptiveThinking).toBe(true);
    expect(isAiEnabled()).toBe(true);
  });

  it("uses Dartmouth when only DARTMOUTH_CHAT_API_KEY is set", () => {
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    const p = resolveAiProvider();
    expect(p?.name).toBe("dartmouth");
    expect(p?.model).toBe("anthropic.claude-3-5-haiku-20241022");
    expect(p?.adaptiveThinking).toBe(false);
    expect(p?.client.baseURL).toBe("https://chat.dartmouth.edu/api");
    expect(isAiEnabled()).toBe(true);
  });

  it("prefers first-party Anthropic when both keys are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    expect(resolveAiProvider()?.name).toBe("anthropic");
  });

  it("AI_PROVIDER=dartmouth forces the Dartmouth gateway over first-party", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    process.env.AI_PROVIDER = "dartmouth";
    expect(resolveAiProvider()?.name).toBe("dartmouth");
  });

  it("honors DARTMOUTH_CHAT_MODEL and DARTMOUTH_CHAT_BASE_URL overrides", () => {
    process.env.DARTMOUTH_CHAT_API_KEY = "dartmouth-test";
    process.env.DARTMOUTH_CHAT_MODEL = "anthropic.claude-sonnet-4";
    process.env.DARTMOUTH_CHAT_BASE_URL = "https://chat.example.edu/api";
    const p = resolveAiProvider();
    expect(p?.model).toBe("anthropic.claude-sonnet-4");
    expect(p?.client.baseURL).toBe("https://chat.example.edu/api");
  });
});
