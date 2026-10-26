import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal in-process stand-in for the realtime bus, so the test can see what
// is published to other machines and play messages back as if from one.
const bus = vi.hoisted(() => {
  const subs = new Map<string, Set<(event: "change" | "sync", data?: string) => void>>();
  const published: [string, string | undefined][] = [];
  return {
    subs,
    published,
    publish: (topic: string, data?: string) => {
      published.push([topic, data]);
      for (const fn of subs.get(topic) ?? []) fn("change", data);
    },
    subscribe: (topic: string, fn: (event: "change" | "sync", data?: string) => void) => {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic)!.add(fn);
      return () => subs.get(topic)!.delete(fn);
    },
    fromOtherMachine: (data?: string, event: "change" | "sync" = "change") => {
      for (const fn of subs.get("layout-cache") ?? []) fn(event, data);
    },
  };
});
vi.mock("~/lib/realtime-bus.server", () => ({ publish: bus.publish, subscribe: bus.subscribe }));

import { clearTtlCache, setTtlCacheEnabledForTests } from "~/lib/ttl-cache";
import { runDbOperationHooks } from "~/lib/db-write-hooks";
import {
  cachedForLayout,
  invalidateLayoutCache,
  invalidateLayoutCacheForWrite,
  LAB_SCOPE,
  LAYOUT_CACHE_TTL_MS,
  LAYOUT_PIECES_BY_MODEL,
  WRITE_OPERATIONS,
} from "~/lib/layout-cache.server";

const counter = () => {
  let n = 0;
  return vi.fn(async () => ++n);
};
const nextTick = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  setTtlCacheEnabledForTests(true);
  // Let a batch an earlier test queued flush before this one watches the bus.
  await nextTick();
  bus.published.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  clearTtlCache();
  setTtlCacheEnabledForTests(null);
});

describe("cachedForLayout", () => {
  it("reuses a user's value within the piece's TTL", async () => {
    const compute = counter();
    expect(await cachedForLayout("ada", "roles", compute)).toBe(1);
    expect(await cachedForLayout("ada", "roles", compute)).toBe(1);
    expect(compute).toHaveBeenCalledOnce();
  });

  it("re-reads once the piece's TTL passes", async () => {
    vi.useFakeTimers();
    const compute = counter();
    await cachedForLayout("ada", "gates", compute);
    vi.advanceTimersByTime(LAYOUT_CACHE_TTL_MS.gates + 1);
    expect(await cachedForLayout("ada", "gates", compute)).toBe(2);
  });

  it("keeps users apart", async () => {
    const compute = counter();
    await cachedForLayout("ada", "roles", compute);
    expect(await cachedForLayout("grace", "roles", compute)).toBe(2);
  });

  it("keeps pieces apart", async () => {
    const compute = counter();
    await cachedForLayout("ada", "roles", compute);
    expect(await cachedForLayout("ada", "mentor", compute)).toBe(2);
  });

  it("keeps variants apart", async () => {
    const compute = counter();
    await cachedForLayout("ada", "hiring", compute, { variant: "live:c1" });
    expect(await cachedForLayout("ada", "hiring", compute, { variant: "live:c1,c2" })).toBe(2);
    expect(await cachedForLayout("ada", "hiring", compute, { variant: "live:c1" })).toBe(1);
  });

  it("never caches a value shouldCache rejects", async () => {
    const compute = counter();
    const owedOnlyWhenOdd = { shouldCache: (n: number) => n % 2 === 0 };
    expect(await cachedForLayout("ada", "gates", compute, owedOnlyWhenOdd)).toBe(1);
    expect(await cachedForLayout("ada", "gates", compute, owedOnlyWhenOdd)).toBe(2);
    expect(await cachedForLayout("ada", "gates", compute, owedOnlyWhenOdd)).toBe(2);
  });

  it("caches lab-wide reads under the lab scope", async () => {
    const compute = counter();
    await cachedForLayout(LAB_SCOPE, "activities", compute);
    expect(await cachedForLayout(LAB_SCOPE, "activities", compute)).toBe(1);
  });
});

describe("invalidateLayoutCache", () => {
  it("clears one user's piece and leaves other users cached", async () => {
    const compute = counter();
    await cachedForLayout("ada", "favorites", compute);
    await cachedForLayout("grace", "favorites", compute);
    invalidateLayoutCache("favorites", ["ada"]);
    expect(await cachedForLayout("ada", "favorites", compute)).toBe(3);
    expect(await cachedForLayout("grace", "favorites", compute)).toBe(2);
  });

  it("clears a piece for every user, including every variant, and leaves other pieces", async () => {
    const compute = counter();
    await cachedForLayout("ada", "hiring", compute, { variant: "a" });
    await cachedForLayout("grace", "hiring", compute, { variant: "b" });
    await cachedForLayout("ada", "roles", compute);
    invalidateLayoutCache("hiring");
    expect(await cachedForLayout("ada", "hiring", compute, { variant: "a" })).toBe(4);
    expect(await cachedForLayout("grace", "hiring", compute, { variant: "b" })).toBe(5);
    expect(await cachedForLayout("ada", "roles", compute)).toBe(3);
  });

  it("does not clear a user whose id prefixes another's", async () => {
    const compute = counter();
    await cachedForLayout("ada2", "roles", compute);
    invalidateLayoutCache("roles", ["ada"]);
    expect(await cachedForLayout("ada2", "roles", compute)).toBe(1);
  });

  it("tells other machines about a per-user clear right away", () => {
    invalidateLayoutCache("favorites", ["ada", "ada", "grace"]);
    expect(bus.published).toEqual([
      ["layout-cache", JSON.stringify({ piece: "favorites", userIds: ["ada", "grace"] })],
    ]);
  });

  it("does nothing for an empty user list", () => {
    invalidateLayoutCache("favorites", []);
    expect(bus.published).toEqual([]);
  });

  it("clears locally at once but batches lab-wide clears to one message per piece per tick", async () => {
    const compute = counter();
    await cachedForLayout("ada", "mentor", compute);
    for (let i = 0; i < 50; i++) invalidateLayoutCache("mentor");
    invalidateLayoutCache("roles");
    expect(await cachedForLayout("ada", "mentor", compute)).toBe(2);
    expect(bus.published).toEqual([]);
    await nextTick();
    expect(bus.published).toEqual([
      ["layout-cache", JSON.stringify({ piece: "mentor" })],
      ["layout-cache", JSON.stringify({ piece: "roles" })],
    ]);
  });

  it("starts a new batch after a flush", async () => {
    invalidateLayoutCache("mentor");
    await nextTick();
    invalidateLayoutCache("mentor");
    await nextTick();
    expect(bus.published).toHaveLength(2);
  });
});

describe("clears from other machines", () => {
  it("applies a per-user clear", async () => {
    const compute = counter();
    await cachedForLayout("ada", "roles", compute);
    await cachedForLayout("grace", "roles", compute);
    bus.fromOtherMachine(JSON.stringify({ piece: "roles", userIds: ["ada"] }));
    expect(await cachedForLayout("ada", "roles", compute)).toBe(3);
    expect(await cachedForLayout("grace", "roles", compute)).toBe(2);
  });

  it("applies a lab-wide clear", async () => {
    const compute = counter();
    await cachedForLayout("ada", "gates", compute);
    bus.fromOtherMachine(JSON.stringify({ piece: "gates" }));
    expect(await cachedForLayout("ada", "gates", compute)).toBe(2);
  });

  it.each([
    ["a sync (Redis reconnected, clears may have been lost)", undefined, "sync"],
    ["a message with no payload", undefined, "change"],
    ["a malformed payload", "{nope", "change"],
  ] as const)("clears everything on %s", async (_label, data, event) => {
    const compute = counter();
    await cachedForLayout("ada", "roles", compute);
    await cachedForLayout("grace", "favorites", compute);
    bus.fromOtherMachine(data, event);
    expect(await cachedForLayout("ada", "roles", compute)).toBe(3);
    expect(await cachedForLayout("grace", "favorites", compute)).toBe(4);
  });

  it("leaves non-layout cache entries alone on a full clear", async () => {
    const { cachedForTtl } = await import("~/lib/ttl-cache");
    const compute = counter();
    await cachedForTtl("term:current", 60_000, compute);
    await cachedForLayout("ada", "roles", counter());
    bus.fromOtherMachine(undefined, "sync");
    expect(await cachedForTtl("term:current", 60_000, compute)).toBe(1);
  });
});

describe("invalidateLayoutCacheForWrite", () => {
  it.each(Object.entries(LAYOUT_PIECES_BY_MODEL))(
    "a write to %s clears its pieces lab-wide",
    async (model, pieces) => {
      const compute = counter();
      for (const piece of pieces) await cachedForLayout("ada", piece, compute);
      invalidateLayoutCacheForWrite(model, "update");
      const before = compute.mock.calls.length;
      for (const piece of pieces) await cachedForLayout("ada", piece, compute);
      expect(compute.mock.calls.length).toBe(before + pieces.length);
    },
  );

  it.each([...WRITE_OPERATIONS])("%s counts as a write", async (operation) => {
    const compute = counter();
    await cachedForLayout("ada", "roles", compute);
    invalidateLayoutCacheForWrite("CoreAssignment", operation);
    expect(await cachedForLayout("ada", "roles", compute)).toBe(2);
  });

  it.each(["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"])(
    "%s does not clear anything",
    async (operation) => {
      const compute = counter();
      await cachedForLayout("ada", "roles", compute);
      invalidateLayoutCacheForWrite("CoreAssignment", operation);
      expect(await cachedForLayout("ada", "roles", compute)).toBe(1);
    },
  );

  it("ignores writes to tables the layout doesn't cache, and raw queries", async () => {
    const compute = counter();
    await cachedForLayout("ada", "favorites", compute);
    invalidateLayoutCacheForWrite("UserFavorite", "update");
    invalidateLayoutCacheForWrite("Page", "update");
    invalidateLayoutCacheForWrite(undefined, "executeRaw");
    expect(await cachedForLayout("ada", "favorites", compute)).toBe(1);
    await nextTick();
    expect(bus.published).toEqual([]);
  });

  it("is registered with db.ts, so a real write reaches it", async () => {
    const compute = counter();
    await cachedForLayout("ada", "roles", compute);
    runDbOperationHooks("CoreAssignment", "createMany");
    expect(await cachedForLayout("ada", "roles", compute)).toBe(2);
  });

  it("names only models that exist in the Prisma schema", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../../prisma/schema.prisma"), "utf8");
    for (const model of Object.keys(LAYOUT_PIECES_BY_MODEL)) {
      expect(schema, model).toMatch(new RegExp(`^model ${model} \\{`, "m"));
    }
  });
});
