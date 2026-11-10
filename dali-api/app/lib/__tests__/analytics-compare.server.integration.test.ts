import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { priorViewsByPath } from "~/lib/analytics-compare.server";

const view = (path: string, at: string) =>
  prisma.pageView.create({ data: { path, sessionId: "s1", createdAt: new Date(at) } });

describe("priorViewsByPath", () => {
  it("counts views per path in [since - days, since), inclusive start and exclusive end", async () => {
    const since = new Date("2026-10-08T00:00:00Z");
    await view("/a", "2026-10-01T00:00:00Z"); // exactly priorSince: included
    await view("/a", "2026-10-07T23:59:59Z"); // included
    await view("/a", "2026-10-08T00:00:00Z"); // == since: excluded
    await view("/a", "2026-09-30T23:59:59Z"); // before window: excluded
    await view("/b", "2026-10-03T12:00:00Z");
    await view("/c", "2026-10-03T12:00:00Z"); // not requested
    const res = await priorViewsByPath(prisma, ["/a", "/b", "/missing"], since, 7);
    expect(Object.fromEntries(res)).toEqual({ "/a": 2, "/b": 1 });
  });

  it("returns an empty map for no paths without querying", async () => {
    expect((await priorViewsByPath(prisma, [], new Date(), 7)).size).toBe(0);
  });

  it("returns counts as numbers, not bigint", async () => {
    await view("/a", "2026-10-03T00:00:00Z");
    const res = await priorViewsByPath(prisma, ["/a"], new Date("2026-10-08T00:00:00Z"), 7);
    expect(typeof res.get("/a")).toBe("number");
  });
});
