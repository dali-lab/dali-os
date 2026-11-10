import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bus = vi.hoisted(() => {
  const subs = new Map<string, Set<(event: "change" | "sync", data?: string) => void>>();
  const published: [string, string | undefined][] = [];
  return {
    published,
    publish: (topic: string, data?: string) => {
      published.push([topic, data]);
    },
    subscribe: (topic: string, fn: (event: "change" | "sync", data?: string) => void) => {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic)!.add(fn);
      return () => subs.get(topic)!.delete(fn);
    },
    fromOtherMachine: (data?: string, event: "change" | "sync" = "change") => {
      for (const fn of subs.get("reference-cache") ?? []) fn(event, data);
    },
  };
});
vi.mock("~/lib/realtime-bus.server", () => ({ publish: bus.publish, subscribe: bus.subscribe }));

const db = vi.hoisted(() => ({
  term: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
  groupDefinition: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
  getActiveCoreCycleTermIds: vi.fn(),
  isLabMentor: vi.fn(),
}));

import { cachedForTtl, clearTtlCache, setTtlCacheEnabledForTests } from "~/lib/ttl-cache";
import { runDbOperationHooks } from "~/lib/db-write-hooks";
import { currentTerm } from "~/lib/roles";
import {
  activeDomainOptions,
  cachedDomains,
  cachedGroupDefinitions,
  cachedTerms,
  invalidateReferenceCache,
  invalidateReferenceCacheForWrite,
} from "~/lib/reference-cache.server";
import { resolveTermFilter, termWindows } from "~/lib/terms";
import { listAllGroups, listVisibleGroupIdsForUser, loadGroupArchiveContext } from "~/lib/groups";

const nextTick = () => new Promise((r) => setImmediate(r));
const request = new Request("http://test/?term=all");

const term = (code: string, sortKey: number) => ({
  id: `t-${code}`,
  code,
  year: 2026,
  season: "Spring",
  sortKey,
  startDate: new Date("2026-03-30T00:00:00Z"),
  endDate: new Date("2026-06-10T00:00:00Z"),
});

beforeEach(async () => {
  vi.clearAllMocks();
  setTtlCacheEnabledForTests(true);
  await nextTick();
  bus.published.length = 0;
  db.term.findMany.mockResolvedValue([term("26S", 262), term("26W", 261)]);
  db.domain.findMany.mockResolvedValue([{ id: "d1", displayName: "Design", active: true }]);
  db.groupDefinition.findMany.mockResolvedValue([
    { id: "g1", name: "Ada's group", type: "Static", staticMemberIds: ["ada"], boundTermIds: ["t-26S"], archivedAt: null },
  ]);
  db.project.findMany.mockResolvedValue([]);
  vi.mocked(currentTerm).mockResolvedValue(term("26S", 262) as never);
});

afterEach(() => {
  clearTtlCache();
  setTtlCacheEnabledForTests(null);
});

describe("reference reads", () => {
  it.each([
    ["terms", cachedTerms, db.term, { orderBy: { sortKey: "desc" } }],
    ["domains", cachedDomains, db.domain, { orderBy: { displayName: "asc" } }],
    ["group definitions", cachedGroupDefinitions, db.groupDefinition, { orderBy: { name: "asc" } }],
  ] as const)("reads %s once, in the order the old queries used", async (_n, read, model, args) => {
    const first = await read();
    const second = await read();
    expect(second).toEqual(first);
    expect(model.findMany).toHaveBeenCalledExactlyOnceWith(args);
  });

  it("gives active domains as id and display name only", async () => {
    db.domain.findMany.mockResolvedValueOnce([
      { id: "d1", displayName: "Design", active: true, code: "UIUX" },
      { id: "d2", displayName: "Retired", active: false, code: "OLD" },
    ]);
    expect(await activeDomainOptions()).toEqual([{ id: "d1", displayName: "Design" }]);
  });

  it("hands every caller its own copy, so mutating one can't change the cache", async () => {
    const first = await cachedTerms();
    first[0]!.startDate.setFullYear(1999);
    first[0]!.code = "mutated";
    first.pop();
    const second = await cachedTerms();
    expect(second).toHaveLength(2);
    expect(second[0]!.code).toBe("26S");
    expect(second[0]!.startDate.toISOString()).toBe("2026-03-30T00:00:00.000Z");
  });

  it("copies array fields too", async () => {
    const first = await cachedGroupDefinitions();
    first[0]!.staticMemberIds.push("intruder");
    first[0]!.boundTermIds.length = 0;
    const second = await cachedGroupDefinitions();
    expect(second[0]!.staticMemberIds).toEqual(["ada"]);
    expect(second[0]!.boundTermIds).toEqual(["t-26S"]);
  });

  it("does not cache a failed read", async () => {
    db.term.findMany.mockRejectedValueOnce(new Error("down"));
    await expect(cachedTerms()).rejects.toThrow("down");
    expect(await cachedTerms()).toHaveLength(2);
  });
});

describe("invalidation", () => {
  it.each([
    ["Term", cachedTerms, db.term],
    ["Domain", cachedDomains, db.domain],
    ["GroupDefinition", cachedGroupDefinitions, db.groupDefinition],
  ] as const)("a %s write re-reads that table and tells other machines once", async (model, read, table) => {
    await read();
    runDbOperationHooks(model, "update");
    runDbOperationHooks(model, "create");
    runDbOperationHooks(model, "deleteMany");
    await read();
    expect(table.findMany).toHaveBeenCalledTimes(2);
    await nextTick();
    expect(bus.published).toEqual([["reference-cache", model]]);
  });

  it("leaves the other tables cached", async () => {
    await Promise.all([cachedTerms(), cachedDomains(), cachedGroupDefinitions()]);
    runDbOperationHooks("Domain", "update");
    await Promise.all([cachedTerms(), cachedDomains(), cachedGroupDefinitions()]);
    expect(db.term.findMany).toHaveBeenCalledOnce();
    expect(db.groupDefinition.findMany).toHaveBeenCalledOnce();
    expect(db.domain.findMany).toHaveBeenCalledTimes(2);
  });

  it("batches different tables written in one tick into one publish each", async () => {
    runDbOperationHooks("Term", "update");
    runDbOperationHooks("Domain", "update");
    runDbOperationHooks("Term", "update");
    await nextTick();
    expect(bus.published).toEqual([
      ["reference-cache", "Term"],
      ["reference-cache", "Domain"],
    ]);
  });

  it("ignores reads, raw queries and other models", async () => {
    await cachedTerms();
    invalidateReferenceCacheForWrite("Term", "findMany");
    invalidateReferenceCacheForWrite("Term", "count");
    invalidateReferenceCacheForWrite("Project", "update");
    invalidateReferenceCacheForWrite(undefined, "$executeRaw");
    await cachedTerms();
    expect(db.term.findMany).toHaveBeenCalledOnce();
    await nextTick();
    expect(bus.published).toEqual([]);
  });

  it("a Term write also clears the current-term keys", async () => {
    const compute = vi.fn(async () => "term");
    await cachedForTtl("term:current", 60_000, compute);
    await cachedForTtl("term:currentStrict", 60_000, compute);
    runDbOperationHooks("Term", "update");
    await cachedForTtl("term:current", 60_000, compute);
    await cachedForTtl("term:currentStrict", 60_000, compute);
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it("a Domain write leaves the current-term keys alone", async () => {
    const compute = vi.fn(async () => "term");
    await cachedForTtl("term:current", 60_000, compute);
    runDbOperationHooks("Domain", "update");
    await cachedForTtl("term:current", 60_000, compute);
    expect(compute).toHaveBeenCalledOnce();
  });

  it("a change from another machine clears that table and the term keys", async () => {
    await cachedTerms();
    await cachedDomains();
    const compute = vi.fn(async () => "term");
    await cachedForTtl("term:current", 60_000, compute);
    bus.fromOtherMachine("Term");
    await cachedTerms();
    await cachedDomains();
    await cachedForTtl("term:current", 60_000, compute);
    expect(db.term.findMany).toHaveBeenCalledTimes(2);
    expect(db.domain.findMany).toHaveBeenCalledOnce();
    expect(compute).toHaveBeenCalledTimes(2);
    expect(bus.published).toEqual([]);
  });

  it.each([
    ["a sync", undefined, "sync"],
    ["a message it can't read", "Banana", "change"],
    ["a message with no payload", undefined, "change"],
  ] as const)("%s clears everything", async (_n, data, event) => {
    await Promise.all([cachedTerms(), cachedDomains(), cachedGroupDefinitions()]);
    bus.fromOtherMachine(data, event);
    await Promise.all([cachedTerms(), cachedDomains(), cachedGroupDefinitions()]);
    expect(db.term.findMany).toHaveBeenCalledTimes(2);
    expect(db.domain.findMany).toHaveBeenCalledTimes(2);
    expect(db.groupDefinition.findMany).toHaveBeenCalledTimes(2);
  });

  it("drops an in-flight read that started before the clear", async () => {
    let release!: (rows: unknown[]) => void;
    db.term.findMany.mockReturnValueOnce(new Promise((r) => (release = r)));
    const stale = cachedTerms();
    invalidateReferenceCache("Term");
    release([term("OLD", 1)]);
    await stale;
    expect((await cachedTerms())[0]!.code).toBe("26S");
  });
});

describe("terms", () => {
  it("resolveTermFilter reads the term table once across requests", async () => {
    const first = await resolveTermFilter(request);
    const second = await resolveTermFilter(new Request("http://test/?term=t-26W"));
    expect(first.terms).toEqual([
      { id: "t-26S", code: "26S", isCurrent: true },
      { id: "t-26W", code: "26W", isCurrent: false },
    ]);
    expect(second.termIds).toEqual(["t-26W"]);
    expect(db.term.findMany).toHaveBeenCalledOnce();
  });

  it("resolveTermFilter's upcoming set is the current term and later ones", async () => {
    const filter = await resolveTermFilter(new Request("http://test/?term=upcoming"));
    expect(filter.termIds).toEqual(["t-26S"]);
    vi.mocked(currentTerm).mockResolvedValue(term("26W", 261) as never);
    expect((await resolveTermFilter(new Request("http://test/?term=upcoming"))).termIds).toEqual(["t-26S", "t-26W"]);
  });

  it("termWindows returns exactly id, code and the date window, newest first", async () => {
    const windows = await termWindows();
    expect(windows.map((w) => w.code)).toEqual(["26S", "26W"]);
    expect(Object.keys(windows[0]!).sort()).toEqual(["code", "endDate", "id", "startDate"]);
    expect(windows[0]!.startDate).toBeInstanceOf(Date);
  });
});

describe("groups", () => {
  it("loadGroupArchiveContext maps term ends from the cached terms", async () => {
    const context = await loadGroupArchiveContext();
    await loadGroupArchiveContext();
    expect(context.termEndById.get("t-26S")).toEqual(new Date("2026-06-10T00:00:00Z"));
    expect(db.term.findMany).toHaveBeenCalledOnce();
  });

  it("reads static membership fresh for permission checks", async () => {
    const group = (staticMemberIds: string[]) => ({
      id: "g1",
      name: "Ada's group",
      type: "Static",
      dynamicQuery: null,
      staticMemberIds,
      systemKey: null,
      archivedAt: null,
      boundTermIds: [],
    });
    db.groupDefinition.findMany.mockResolvedValue([group(["ada"])]);
    expect((await listVisibleGroupIdsForUser("ada")).map((g) => g.id)).toEqual(["g1"]);
    db.groupDefinition.findMany.mockResolvedValue([group([])]);
    expect(await listVisibleGroupIdsForUser("ada")).toEqual([]);
  });

  it("listAllGroups keeps the shape it had when it selected columns, and doesn't share member arrays", async () => {
    db.groupDefinition.findMany.mockResolvedValue([
      {
        id: "g1",
        name: "Ada's group",
        type: "Static",
        dynamicQuery: null,
        staticMemberIds: ["ada"],
        systemKey: null,
        archivedAt: null,
        boundTermIds: [],
        createdAt: new Date(),
      },
    ]);
    const [group] = await listAllGroups();
    expect(Object.keys(group!).sort()).toEqual(
      ["archived", "archivedAt", "boundTermIds", "dynamicQuery", "id", "memberIds", "name", "systemKey", "type"],
    );
    group!.memberIds.push("intruder");
    expect((await listAllGroups())[0]!.memberIds).toEqual(["ada"]);
  });
});
