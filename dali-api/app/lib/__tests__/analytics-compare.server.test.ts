import { describe, it, expect, vi } from "vitest";
import { percentChange, priorViewsByPath } from "~/lib/analytics-compare.server";

function fakeDb(rows: { path: string; views: number }[]) {
  const $queryRaw = vi.fn(async (..._args: unknown[]) => rows);
  return { db: { $queryRaw } as never, $queryRaw };
}

describe("priorViewsByPath", () => {
  it("skips the query when there are no paths", async () => {
    const { db, $queryRaw } = fakeDb([]);
    const out = await priorViewsByPath(db, [], new Date(), 30);
    expect(out.size).toBe(0);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it("queries the equal-length window ending at since", async () => {
    const { db, $queryRaw } = fakeDb([]);
    const since = new Date("2026-10-01T00:00:00Z");
    await priorViewsByPath(db, ["/a", "/b"], since, 7);
    const values = $queryRaw.mock.calls[0]!.slice(1);
    expect(values).toEqual([["/a", "/b"], new Date("2026-09-24T00:00:00Z"), since]);
    const sql = ($queryRaw.mock.calls[0]![0] as string[]).join("?");
    expect(sql).toContain('"createdAt" >= ?');
    expect(sql).toContain('"createdAt" < ?');
  });

  it("maps rows by path and leaves missing paths absent", async () => {
    const { db } = fakeDb([{ path: "/a", views: 12 }]);
    const out = await priorViewsByPath(db, ["/a", "/b"], new Date(), 30);
    expect(out.get("/a")).toBe(12);
    expect(out.has("/b")).toBe(false);
  });
});

describe("percentChange", () => {
  it("returns null with no prior baseline", () => {
    expect(percentChange(10, 0)).toBeNull();
  });

  it("rounds growth and decline to whole percents", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(1, 3)).toBe(-67);
    expect(percentChange(7, 7)).toBe(0);
  });
});
