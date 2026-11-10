import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { activity: { findMany: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({
  getActiveCoreCycleTermIds: vi.fn(),
  getAdminUserIdsFromEnv: () => [],
}));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));
vi.mock("~/activities/mechanics/registry.server", () => ({ mechanicServer: () => null }));
vi.mock("~/lib/realtime-bus.server", () => ({ publish: vi.fn(), subscribe: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { clearTtlCache, setTtlCacheEnabledForTests } from "~/lib/ttl-cache";
import { invalidateLayoutCache } from "~/lib/layout-cache.server";
import { resolveActiveActivitiesForUser } from "~/lib/activities.server";

const findMany = prisma.activity.findMany as unknown as ReturnType<typeof vi.fn>;
const roles = {} as never;
const t = (min: number) => new Date(Date.UTC(2026, 9, 26, 15, min));

const activity = (id: string, startsAt: Date, endsAt: Date) => ({
  id,
  kind: "hunt",
  name: id,
  startsAt,
  endsAt,
  audienceEveryone: true,
  audienceRoles: [],
  assignedGroupId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  setTtlCacheEnabledForTests(true);
});

afterEach(() => {
  clearTtlCache();
  setTtlCacheEnabledForTests(null);
});

const live = async (now: Date) =>
  (await resolveActiveActivitiesForUser("ada", roles, now, "/")).map((a) => a.id);

describe("resolveActiveActivitiesForUser with cached rows", () => {
  it("reads published activities that haven't ended, without a start filter", async () => {
    findMany.mockResolvedValue([]);
    await live(t(0));
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "Published", endsAt: { gte: t(0) } },
      orderBy: { startsAt: "asc" },
    });
  });

  it("starts an activity on time from rows read before it began", async () => {
    findMany.mockResolvedValue([activity("hunt", t(10), t(40))]);
    expect(await live(t(0))).toEqual([]);
    expect(await live(t(10))).toEqual(["hunt"]);
    expect(findMany).toHaveBeenCalledOnce();
  });

  it("ends an activity on time from rows read while it ran", async () => {
    findMany.mockResolvedValue([activity("hunt", t(0), t(5))]);
    expect(await live(t(4))).toEqual(["hunt"]);
    expect(await live(t(6))).toEqual([]);
    expect(findMany).toHaveBeenCalledOnce();
  });

  it("includes an activity exactly at its start and end", async () => {
    findMany.mockResolvedValue([activity("hunt", t(10), t(20))]);
    expect(await live(t(10))).toEqual(["hunt"]);
    expect(await live(t(20))).toEqual(["hunt"]);
  });

  it("re-reads after an activity write clears the cache", async () => {
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([activity("hunt", t(0), t(30))]);
    expect(await live(t(1))).toEqual([]);
    invalidateLayoutCache("activities");
    expect(await live(t(1))).toEqual(["hunt"]);
  });
});
