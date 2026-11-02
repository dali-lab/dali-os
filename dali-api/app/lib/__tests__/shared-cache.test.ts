import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

class FakeRedis extends EventEmitter {
  options: Record<string, unknown>;
  mget = vi.fn(async (keys: string[]) => keys.map((k) => `value of ${k}`));
  set = vi.fn(async () => "OK");
  disconnect = vi.fn();
  constructor(_url: string, options: Record<string, unknown>) {
    super();
    this.options = options;
    instances.push(this);
  }
}
const instances: FakeRedis[] = [];

vi.mock("ioredis", () => ({
  default: class {
    constructor(url: string, options: Record<string, unknown>) {
      return new FakeRedis(url, options);
    }
  },
}));

import { __resetSharedCacheForTests, sharedCacheGetMany, sharedCacheSet } from "~/lib/shared-cache.server";

beforeEach(() => {
  instances.length = 0;
  vi.stubEnv("REDIS_URL", "redis://example.test");
});

afterEach(() => {
  __resetSharedCacheForTests();
  vi.unstubAllEnvs();
});

describe("shared cache", () => {
  it("misses every key without Redis", async () => {
    vi.stubEnv("REDIS_URL", "");
    expect(await sharedCacheGetMany(["a", "b"])).toEqual([null, null]);
    expect(() => sharedCacheSet("a", "1", 1000)).not.toThrow();
    expect(instances).toHaveLength(0);
  });

  it("reads several keys in one command", async () => {
    expect(await sharedCacheGetMany(["a", "b"])).toEqual(["value of a", "value of b"]);
    expect(instances[0].mget).toHaveBeenCalledTimes(1);
  });

  it("skips Redis for no keys", async () => {
    expect(await sharedCacheGetMany([])).toEqual([]);
    expect(instances).toHaveLength(0);
  });

  it("writes with a millisecond expiry", () => {
    sharedCacheSet("a", "1", 120_000);
    expect(instances[0].set).toHaveBeenCalledWith("a", "1", "PX", 120_000);
  });

  it("treats a failed read as a miss", async () => {
    await sharedCacheGetMany(["a"]);
    instances[0].mget.mockRejectedValueOnce(new Error("timeout"));
    expect(await sharedCacheGetMany(["a", "b"])).toEqual([null, null]);
  });

  it("swallows a failed write", async () => {
    await sharedCacheGetMany(["a"]);
    instances[0].set.mockRejectedValueOnce(new Error("down"));
    expect(() => sharedCacheSet("a", "1", 1000)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("fails fast instead of queueing through an outage", async () => {
    await sharedCacheGetMany(["a"]);
    expect(instances[0].options).toMatchObject({ enableOfflineQueue: false, commandTimeout: 250 });
  });

  it("reuses one connection", async () => {
    await sharedCacheGetMany(["a"]);
    sharedCacheSet("a", "1", 1000);
    expect(instances).toHaveLength(1);
  });

  it("logs connection errors rather than crashing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await sharedCacheGetMany(["a"]);
    instances[0].emit("error", new Error("refused"));
    expect(log).toHaveBeenCalledWith("[shared-cache] redis error", "refused");
    log.mockRestore();
  });
});
