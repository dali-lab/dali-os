import { describe, it, expect, vi } from "vitest";
import {
  parseAuditFilters,
  buildAuditWhere,
  activeFilterParams,
  hasAnyFilter,
  resolveAuditTextFilters,
  looksLikeCuid,
} from "~/lib/audit-query";

function params(init: Record<string, string>): URLSearchParams {
  return new URLSearchParams(init);
}

const EMPTY = {
  action: null,
  userId: null,
  targetId: null,
  actor: null,
  target: null,
  from: null,
  to: null,
};

describe("parseAuditFilters", () => {
  it("returns all-null for empty searchParams", () => {
    expect(parseAuditFilters(params({}))).toEqual(EMPTY);
  });

  it("accepts a known action", () => {
    expect(parseAuditFilters(params({ action: "login.success" }))).toEqual({
      ...EMPTY,
      action: "login.success",
    });
  });

  it("nulls an unknown action silently", () => {
    expect(parseAuditFilters(params({ action: "not.a.real.action" }))).toEqual(EMPTY);
  });

  it("treats empty-string filter values as absent", () => {
    expect(
      parseAuditFilters(params({ action: "", userId: "", targetId: "", from: "", to: "" })),
    ).toEqual(EMPTY);
  });

  it("trims whitespace from id filters", () => {
    expect(parseAuditFilters(params({ userId: "  user-1  ", targetId: " t-2 " }))).toEqual({
      ...EMPTY,
      userId: "user-1",
      targetId: "t-2",
    });
  });

  it("preserves valid raw date strings for form repopulation", () => {
    expect(parseAuditFilters(params({ from: "2026-05-01", to: "2026-05-24" }))).toEqual({
      ...EMPTY,
      from: "2026-05-01",
      to: "2026-05-24",
    });
  });

  it("nulls invalid dates silently", () => {
    expect(parseAuditFilters(params({ from: "garbage", to: "also-bad" }))).toEqual(EMPTY);
  });

  it("ignores unknown params", () => {
    expect(parseAuditFilters(params({ page: "3", foo: "bar" }))).toEqual(EMPTY);
  });

  it("combines multiple filters", () => {
    expect(
      parseAuditFilters(
        params({
          action: "role.change",
          userId: "actor-1",
          targetId: "victim-1",
          from: "2026-05-01",
        }),
      ),
    ).toEqual({
      action: "role.change",
      userId: "actor-1",
      targetId: "victim-1",
      actor: null,
      target: null,
      from: "2026-05-01",
      to: null,
    });
  });
});

describe("buildAuditWhere", () => {
  it("produces an empty where for no filters", () => {
    expect(buildAuditWhere(EMPTY)).toEqual({});
  });

  it("maps single-field filters straight through", () => {
    expect(buildAuditWhere({ ...EMPTY, action: "login.success" })).toEqual({
      action: "login.success",
    });
    expect(buildAuditWhere({ ...EMPTY, userId: "u-1" })).toEqual({ userId: "u-1" });
    expect(buildAuditWhere({ ...EMPTY, targetId: "t-1" })).toEqual({ targetId: "t-1" });
  });

  it("collapses from/to into a single createdAt range", () => {
    expect(buildAuditWhere({ ...EMPTY, from: "2026-05-01", to: "2026-05-24" })).toEqual({
      createdAt: { gte: new Date("2026-05-01"), lte: new Date("2026-05-24") },
    });
  });

  it("supports a one-sided range", () => {
    expect(buildAuditWhere({ ...EMPTY, from: "2026-05-01" })).toEqual({
      createdAt: { gte: new Date("2026-05-01") },
    });
    expect(buildAuditWhere({ ...EMPTY, to: "2026-05-24" })).toEqual({
      createdAt: { lte: new Date("2026-05-24") },
    });
  });

  it("composes everything together", () => {
    expect(
      buildAuditWhere({
        ...EMPTY,
        action: "role.change",
        userId: "actor-1",
        targetId: "victim-1",
        from: "2026-05-01",
      }),
    ).toEqual({
      action: "role.change",
      userId: "actor-1",
      targetId: "victim-1",
      createdAt: { gte: new Date("2026-05-01") },
    });
  });
});

describe("activeFilterParams", () => {
  it("returns an empty string for no active filters", () => {
    expect(activeFilterParams(EMPTY).toString()).toBe("");
  });

  it("serializes only the active filters", () => {
    const result = activeFilterParams({
      ...EMPTY,
      action: "logout",
      userId: "u-1",
    });
    expect(result.get("action")).toBe("logout");
    expect(result.get("userId")).toBe("u-1");
    expect(result.has("targetId")).toBe(false);
    expect(result.has("from")).toBe(false);
    expect(result.has("to")).toBe(false);
  });
});

describe("hasAnyFilter", () => {
  it("is false for an empty filters object", () => {
    expect(hasAnyFilter(EMPTY)).toBe(false);
  });

  it("is true when any single field is set", () => {
    expect(hasAnyFilter({ ...EMPTY, action: "login.success" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, userId: "u-1" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, actor: "kiran" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, target: "kiran" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, from: "2026-05-01" })).toBe(true);
  });
});

describe("looksLikeCuid", () => {
  it("accepts a typical cuid", () => {
    expect(looksLikeCuid("clx7y2k0m0000abcdefghij01")).toBe(true);
  });

  it("rejects a name", () => {
    expect(looksLikeCuid("kiran")).toBe(false);
    expect(looksLikeCuid("kiran@dali.dartmouth.edu")).toBe(false);
  });

  it("rejects values that don't start with c or are too short", () => {
    expect(looksLikeCuid("abc123")).toBe(false);
    expect(looksLikeCuid("c123")).toBe(false);
  });
});

describe("resolveAuditTextFilters", () => {
  function fakePrisma(matches: { id: string }[]) {
    // Cast through unknown — the helper only ever calls prisma.user.findMany,
    // so a one-method stub is enough.
    return {
      user: {
        findMany: vi.fn().mockResolvedValue(matches),
      },
    } as unknown as Parameters<typeof resolveAuditTextFilters>[0];
  }

  it("returns an empty patch when no text filters are set", async () => {
    const prisma = fakePrisma([]);
    const patch = await resolveAuditTextFilters(prisma, EMPTY);
    expect(patch).toEqual({});
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("short-circuits cuid-shaped actor to an exact userId match", async () => {
    const prisma = fakePrisma([]);
    const patch = await resolveAuditTextFilters(prisma, {
      ...EMPTY,
      actor: "clx7y2k0m0000abcdefghij01",
    });
    expect(patch).toEqual({ userId: "clx7y2k0m0000abcdefghij01" });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("resolves a name-shaped actor through the User table", async () => {
    const prisma = fakePrisma([{ id: "u-1" }, { id: "u-2" }]);
    const patch = await resolveAuditTextFilters(prisma, { ...EMPTY, actor: "kiran" });
    expect(patch).toEqual({ userId: { in: ["u-1", "u-2"] } });
    expect(prisma.user.findMany).toHaveBeenCalledOnce();
  });

  it("yields a no-match sentinel when text search finds nothing", async () => {
    const prisma = fakePrisma([]);
    const patch = await resolveAuditTextFilters(prisma, { ...EMPTY, actor: "nobody" });
    expect(patch).toEqual({ userId: "__no_match__" });
  });

  it("does not overwrite an explicit userId filter", async () => {
    const prisma = fakePrisma([{ id: "u-99" }]);
    const patch = await resolveAuditTextFilters(prisma, {
      ...EMPTY,
      userId: "u-explicit",
      actor: "kiran",
    });
    expect(patch).toEqual({});
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("handles actor and target independently in one call", async () => {
    const prisma = fakePrisma([{ id: "u-1" }]);
    const patch = await resolveAuditTextFilters(prisma, {
      ...EMPTY,
      actor: "clx7y2k0m0000abcdefghij01",
      target: "kiran",
    });
    expect(patch).toEqual({
      userId: "clx7y2k0m0000abcdefghij01",
      targetId: { in: ["u-1"] },
    });
  });
});
