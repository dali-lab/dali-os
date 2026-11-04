import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  cachedExternalRead,
  invalidateExternalCache,
  isFreshCacheEntry,
  markCalendarChanged,
} from "~/calendar/lib/external-cache.server";

const updateMany = prisma.user.updateMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  invalidateExternalCache("u1");
  invalidateExternalCache("u2");
});

describe("isFreshCacheEntry", () => {
  it("is a miss when there is no entry", () => {
    expect(isFreshCacheEntry(undefined, 1000, null)).toBe(false);
  });

  it("is a hit inside the TTL with no marker", () => {
    expect(isFreshCacheEntry({ at: 1000 }, 1000 + 29_999, null)).toBe(true);
  });

  it("is a miss at the TTL", () => {
    expect(isFreshCacheEntry({ at: 1000 }, 1000 + 30_000, null)).toBe(false);
  });

  it("is a miss when the entry started at or before the marker", () => {
    expect(isFreshCacheEntry({ at: 1000 }, 2000, new Date(1000))).toBe(false);
    expect(isFreshCacheEntry({ at: 1000 }, 2000, new Date(1500))).toBe(false);
  });

  it("is a hit when the entry started after the marker", () => {
    expect(isFreshCacheEntry({ at: 1000 }, 2000, new Date(999))).toBe(true);
  });
});

describe("cachedExternalRead", () => {
  it("re-reads when the marker is newer than the cached entry", async () => {
    const read = vi.fn().mockResolvedValue("v");
    await cachedExternalRead("u1:k", read);
    await cachedExternalRead("u1:k", read, new Date(Date.now() + 5000));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("serves the cache when the marker is older than the entry", async () => {
    const read = vi.fn().mockResolvedValue("v");
    const marker = new Date(Date.now() - 5000);
    await cachedExternalRead("u1:k", read, marker);
    await cachedExternalRead("u1:k", read, marker);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stamps the entry with when the read started, so a read racing a write is not trusted", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const read = vi.fn().mockImplementation(async () => {
        vi.setSystemTime(10_500);
        return "v";
      });
      await cachedExternalRead("u1:k", read);
      await cachedExternalRead("u1:k", read, new Date(10_200));
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("markCalendarChanged", () => {
  it("drops local cache for the user and stamps every distinct user once", async () => {
    const read = vi.fn().mockResolvedValue("v");
    await cachedExternalRead("u1:k", read);
    await cachedExternalRead("u2:k", read);

    await markCalendarChanged("u1", ["u2", "u1"]);

    await cachedExternalRead("u1:k", read);
    await cachedExternalRead("u2:k", read);
    expect(read).toHaveBeenCalledTimes(4);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where.id.in.sort()).toEqual(["u1", "u2"]);
    expect(arg.data.calendarDataChangedAt).toBeInstanceOf(Date);
  });

  it("does not throw when the stamp fails", async () => {
    updateMany.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(markCalendarChanged("u1")).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
