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
  person: null,
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
      parseAuditFilters(
        params({ action: "", userId: "", targetId: "", person: "", from: "", to: "" }),
      ),
    ).toEqual(EMPTY);
  });

  it("trims whitespace from text filters", () => {
    expect(
      parseAuditFilters(params({ userId: "  user-1  ", targetId: " t-2 ", person: " kiran " })),
    ).toEqual({
      ...EMPTY,
      userId: "user-1",
      targetId: "t-2",
      person: "kiran",
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
          person: "kiran",
          from: "2026-05-01",
        }),
      ),
    ).toEqual({
      ...EMPTY,
      action: "role.change",
      person: "kiran",
      from: "2026-05-01",
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

  it("ignores the person field — that's the async resolver's job", () => {
    expect(buildAuditWhere({ ...EMPTY, person: "kiran" })).toEqual({});
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
    const result = activeFilterParams({ ...EMPTY, action: "logout", person: "kiran" });
    expect(result.get("action")).toBe("logout");
    expect(result.get("person")).toBe("kiran");
    expect(result.has("userId")).toBe(false);
    expect(result.has("from")).toBe(false);
  });
});

describe("hasAnyFilter", () => {
  it("is false for an empty filters object", () => {
    expect(hasAnyFilter(EMPTY)).toBe(false);
  });

  it("is true when any single field is set", () => {
    expect(hasAnyFilter({ ...EMPTY, action: "login.success" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, userId: "u-1" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, person: "kiran" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY, from: "2026-05-01" })).toBe(true);
  });
});

describe("looksLikeCuid", () => {
  it("accepts a typical cuid", () => {
    expect(looksLikeCuid("clx7y2k0m0000abcdefghij01")).toBe(true);
  });

  it("rejects names and short strings", () => {
    expect(looksLikeCuid("kiran")).toBe(false);
    expect(looksLikeCuid("kiran@dali.dartmouth.edu")).toBe(false);
    expect(looksLikeCuid("c123")).toBe(false);
    expect(looksLikeCuid("abc123")).toBe(false);
  });
});

describe("resolveAuditTextFilters", () => {
  function fakePrisma(matches: { id: string }[]) {
    return {
      user: {
        findMany: vi.fn().mockResolvedValue(matches),
      },
    } as unknown as Parameters<typeof resolveAuditTextFilters>[0];
  }

  it("returns an empty patch when person is not set", async () => {
    const prisma = fakePrisma([]);
    expect(await resolveAuditTextFilters(prisma, EMPTY)).toEqual({});
  });

  it("short-circuits a cuid-shaped person to an OR over both id columns", async () => {
    const prisma = fakePrisma([]);
    const patch = await resolveAuditTextFilters(prisma, {
      ...EMPTY,
      person: "clx7y2k0m0000abcdefghij01",
    });
    expect(patch).toEqual({
      OR: [
        { userId: "clx7y2k0m0000abcdefghij01" },
        { targetId: "clx7y2k0m0000abcdefghij01" },
      ],
    });
  });

  it("resolves a name through the User table and ORs across both columns", async () => {
    const prisma = fakePrisma([{ id: "u-1" }, { id: "u-2" }]);
    const patch = await resolveAuditTextFilters(prisma, { ...EMPTY, person: "kiran" });
    expect(patch).toEqual({
      OR: [{ userId: { in: ["u-1", "u-2"] } }, { targetId: { in: ["u-1", "u-2"] } }],
    });
  });

  it("yields a deliberately impossible OR when text search finds nothing", async () => {
    const prisma = fakePrisma([]);
    const patch = await resolveAuditTextFilters(prisma, { ...EMPTY, person: "nobody" });
    expect(patch).toEqual({
      OR: [{ userId: "__no_match__" }, { targetId: "__no_match__" }],
    });
  });
});
