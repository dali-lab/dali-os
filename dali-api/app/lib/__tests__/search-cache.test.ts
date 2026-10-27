import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchCache, searchWithCache } from "~/lib/search-cache";

const names = ["ada", "alan", "grace"];
const matches = (item: string, q: string) => item.includes(q);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(max?: number) {
  const fetch = vi.fn(async (q: string): Promise<string[] | null> => names.filter((n) => n.includes(q)));
  return { fetch, cache: createSearchCache<string>({ fetch, matches, maxEntries: max }) };
}

describe("createSearchCache", () => {
  it("returns an exact hit regardless of case and padding", async () => {
    const { cache } = make();
    await cache.load("Ad ");
    expect(cache.peek("ad")).toMatchObject({ items: ["ada"], exact: true });
  });

  it("falls back to the longest cached prefix, filtered", async () => {
    const { cache } = make();
    await cache.load("");
    await cache.load("a");
    expect(cache.peek("al")).toMatchObject({ items: ["alan"], exact: false });
    expect(cache.peek("g")).toMatchObject({ items: ["grace"], exact: false });
  });

  it("serves exact hits only when no matcher is given", async () => {
    const cache = createSearchCache<string>({ fetch: async (q) => names.filter((n) => n.includes(q)) });
    await cache.load("a");
    expect(cache.peek("a")?.exact).toBe(true);
    expect(cache.peek("al")).toBeNull();
  });

  it("misses when nothing is a prefix", async () => {
    const { cache } = make();
    await cache.load("a");
    expect(cache.peek("g")).toBeNull();
  });

  it("shares one request between concurrent loads of a query", async () => {
    const { cache, fetch } = make();
    await Promise.all([cache.load("a"), cache.load("A")]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const fetch = vi.fn(async () => null);
    const cache = createSearchCache<string>({ fetch, matches });
    expect(await cache.load("a")).toBeNull();
    expect(cache.peek("a")).toBeNull();
  });

  it("evicts the oldest entry past the bound", async () => {
    const { cache } = make(3);
    for (const q of ["a", "b", "c", "d"]) await cache.load(q);
    expect(cache.peek("a")).toBeNull();
    expect(cache.peek("d")?.exact).toBe(true);
  });

  it("clear drops everything", async () => {
    const { cache } = make();
    await cache.load("a");
    cache.clear();
    expect(cache.peek("a")).toBeNull();
  });

  it("only the last of a burst of debounced loads hits the network", async () => {
    const { cache, fetch } = make();
    const first = cache.loadDebounced("a");
    const last = cache.loadDebounced("ad");
    await vi.advanceTimersByTimeAsync(200);
    expect(await first).toBeNull();
    expect(await last).toEqual(["ada"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("ad");
  });
});

describe("searchWithCache", () => {
  it("waits for the network on a cold cache", async () => {
    const { cache } = make();
    const result = searchWithCache(cache, "gr");
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toEqual(["grace"]);
  });

  it("does not refetch an exact hit that was just loaded", async () => {
    const { cache, fetch } = make();
    await cache.load("a");
    fetch.mockClear();
    expect(await searchWithCache(cache, "a")).toEqual(["ada", "alan", "grace"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls onFresh only when the refresh differs from what it returned", async () => {
    const { cache, fetch } = make();
    await cache.load("a");
    await vi.advanceTimersByTimeAsync(3000);

    const onFresh = vi.fn();
    await searchWithCache(cache, "a", onFresh);
    await vi.advanceTimersByTimeAsync(200);
    expect(onFresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    fetch.mockImplementation(async () => ["ada"]);
    await searchWithCache(cache, "a", onFresh);
    await vi.advanceTimersByTimeAsync(200);
    expect(onFresh).toHaveBeenCalledTimes(1);
  });
});
