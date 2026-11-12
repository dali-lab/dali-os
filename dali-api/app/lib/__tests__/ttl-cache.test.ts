import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedForTtl, clearTtlCache, setTtlCacheEnabledForTests, ttlCacheSizeForTests } from "~/lib/ttl-cache";
import { reportPerfStats } from "~/lib/perf-stats";

describe("cachedForTtl", () => {
  it("counts an entry and an in-flight share as hits, and a compute as a miss", async () => {
    setTtlCacheEnabledForTests(true);
    clearTtlCache();
    reportPerfStats(() => {});
    const first = cachedForTtl("stats:key", 1000, async () => "v");
    const shared = cachedForTtl("stats:key", 1000, async () => "v");
    await Promise.all([first, shared]);
    await cachedForTtl("stats:key", 1000, async () => "v");
    const lines: string[] = [];
    reportPerfStats((line) => lines.push(line));
    expect(lines).toEqual(["[cache-stats] stats:key hit=2 miss=1 rate=67%"]);
    setTtlCacheEnabledForTests(null);
  });

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

  it("does not cache a value shouldCache rejects", async () => {
    const compute = vi.fn(async () => "owed");
    await cachedForTtl("k", 1000, compute, (v) => v !== "owed");
    await cachedForTtl("k", 1000, compute, (v) => v !== "owed");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("caches a value shouldCache accepts", async () => {
    const compute = vi.fn(async () => "clear");
    await cachedForTtl("k", 1000, compute, (v) => v !== "owed");
    await cachedForTtl("k", 1000, compute, (v) => v !== "owed");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not store a result whose key was cleared while it was in flight", async () => {
    let resolveStale!: (v: string) => void;
    const stale = vi.fn(() => new Promise<string>((r) => (resolveStale = r)));
    const pending = cachedForTtl("k", 1000, stale);
    clearTtlCache("k");
    resolveStale("old");
    expect(await pending).toBe("old");

    const fresh = vi.fn(async () => "new");
    expect(await cachedForTtl("k", 1000, fresh)).toBe("new");
    expect(fresh).toHaveBeenCalledOnce();
  });

  it("a cleared in-flight read does not evict the read that replaced it", async () => {
    let resolveFirst!: (v: string) => void;
    const first = cachedForTtl("k", 1000, () => new Promise<string>((r) => (resolveFirst = r)));
    clearTtlCache("k");
    let resolveSecond!: (v: string) => void;
    const second = cachedForTtl("k", 1000, () => new Promise<string>((r) => (resolveSecond = r)));
    resolveFirst("old");
    await first;
    const joiner = vi.fn(async () => "unused");
    const third = cachedForTtl("k", 1000, joiner);
    resolveSecond("new");
    expect(await second).toBe("new");
    expect(await third).toBe("new");
    expect(joiner).not.toHaveBeenCalled();
  });

  it("is a pass-through when disabled", async () => {
    setTtlCacheEnabledForTests(false);
    const compute = vi.fn(async () => "v");
    await cachedForTtl("k", 1000, compute);
    await cachedForTtl("k", 1000, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("drops expired entries once the map is full and keeps live ones", async () => {
    for (let i = 0; i < 995; i++) await cachedForTtl(`sweep:short:${i}`, 10, async () => i);
    for (let i = 0; i < 5; i++) await cachedForTtl(`sweep:long:${i}`, 60_000, async () => i);
    expect(ttlCacheSizeForTests()).toBe(1000);

    vi.advanceTimersByTime(1000);
    await cachedForTtl("sweep:new", 60_000, async () => "n");

    expect(ttlCacheSizeForTests()).toBe(6);
    const compute = vi.fn(async () => "again");
    await cachedForTtl("sweep:long:0", 60_000, compute);
    expect(compute).not.toHaveBeenCalled();
  });

  it("does not sweep below the threshold", async () => {
    for (let i = 0; i < 10; i++) await cachedForTtl(`small:${i}`, 10, async () => i);
    vi.advanceTimersByTime(1000);
    await cachedForTtl("small:new", 10, async () => "n");
    expect(ttlCacheSizeForTests()).toBe(11);
  });
});
