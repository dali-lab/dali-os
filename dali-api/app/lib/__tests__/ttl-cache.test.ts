import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedForTtl, clearTtlCache, setTtlCacheEnabledForTests } from "~/lib/ttl-cache";

describe("cachedForTtl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setTtlCacheEnabledForTests(true);
  });
  afterEach(() => {
    setTtlCacheEnabledForTests(null);
    vi.useRealTimers();
  });

  it("computes once within the TTL and again after it expires", async () => {
    const compute = vi.fn(async () => "v");
    expect(await cachedForTtl("k", 1000, compute)).toBe("v");
    expect(await cachedForTtl("k", 1000, compute)).toBe("v");
    expect(compute).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    expect(await cachedForTtl("k", 1000, compute)).toBe("v");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight computation between concurrent callers", async () => {
    let resolve!: (v: string) => void;
    const compute = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const a = cachedForTtl("k", 1000, compute);
    const b = cachedForTtl("k", 1000, compute);
    resolve("v");
    expect(await Promise.all([a, b])).toEqual(["v", "v"]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejection", async () => {
    const compute = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("v");
    await expect(cachedForTtl("k", 1000, compute)).rejects.toThrow("boom");
    expect(await cachedForTtl("k", 1000, compute)).toBe("v");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("clearTtlCache drops entries by prefix", async () => {
    const compute = vi.fn(async () => "v");
    await cachedForTtl("term:a", 1000, compute);
    await cachedForTtl("flag:b", 1000, compute);
    clearTtlCache("term:");
    await cachedForTtl("term:a", 1000, compute);
    await cachedForTtl("flag:b", 1000, compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("is a pass-through when disabled", async () => {
    setTtlCacheEnabledForTests(false);
    const compute = vi.fn(async () => "v");
    await cachedForTtl("k", 1000, compute);
    await cachedForTtl("k", 1000, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
