import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function loadDevLogin(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import("~/lib/dev-login");
}

describe("isDevLoginEnabled", () => {
  it("returns true when NODE_ENV is development", async () => {
    const { isDevLoginEnabled } = await loadDevLogin({ NODE_ENV: "development", ENABLE_DEV_LOGIN: undefined });
    expect(isDevLoginEnabled()).toBe(true);
  });

  it("returns true when NODE_ENV is test", async () => {
    const { isDevLoginEnabled } = await loadDevLogin({ NODE_ENV: "test", ENABLE_DEV_LOGIN: undefined });
    expect(isDevLoginEnabled()).toBe(true);
  });

  it("returns false when NODE_ENV is production", async () => {
    const { isDevLoginEnabled } = await loadDevLogin({ NODE_ENV: "production", ENABLE_DEV_LOGIN: undefined });
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("returns false when NODE_ENV is production even if ENABLE_DEV_LOGIN=true", async () => {
    const { isDevLoginEnabled } = await loadDevLogin({ NODE_ENV: "production", ENABLE_DEV_LOGIN: "true" });
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("returns false when NODE_ENV is unset", async () => {
    const { isDevLoginEnabled } = await loadDevLogin({ NODE_ENV: undefined, ENABLE_DEV_LOGIN: undefined });
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("returns false when NODE_ENV is unset even if ENABLE_DEV_LOGIN=true", async () => {
    const { isDevLoginEnabled } = await loadDevLogin({ NODE_ENV: undefined, ENABLE_DEV_LOGIN: "true" });
    expect(isDevLoginEnabled()).toBe(false);
  });
});
