import { describe, it, expect } from "vitest";
import {
  parseAuditFilters,
  buildAuditWhere,
  activeFilterParams,
  hasActiveFilters,
} from "~/lib/audit-query";

const params = (init: Record<string, string>) => new URLSearchParams(init);

describe("buildAuditWhere", () => {
  it("returns an empty where for no params", () => {
    expect(buildAuditWhere(params({}))).toEqual({});
  });

  it("filters by a known action", () => {
    expect(buildAuditWhere(params({ action: "role.change" }))).toEqual({
      action: "role.change",
    });
  });

  it("ignores an unknown action", () => {
    expect(buildAuditWhere(params({ action: "not.a.real.action" }))).toEqual({});
  });

  it("filters by actor (userId) and target (targetId)", () => {
    expect(buildAuditWhere(params({ userId: "u-1", targetId: "t-2" }))).toEqual({
      userId: "u-1",
      targetId: "t-2",
    });
  });

  it("trims whitespace and drops empty string filters", () => {
    expect(buildAuditWhere(params({ userId: "  u-9  ", targetId: "   " }))).toEqual({
      userId: "u-9",
    });
  });

  it("builds a createdAt range from valid from/to dates", () => {
    const where = buildAuditWhere(params({ from: "2026-01-01", to: "2026-02-01" }));
    expect(where.createdAt).toEqual({
      gte: new Date("2026-01-01"),
      lte: new Date("2026-02-01"),
    });
  });

  it("supports an open-ended range (from only / to only)", () => {
    expect(buildAuditWhere(params({ from: "2026-01-01" })).createdAt).toEqual({
      gte: new Date("2026-01-01"),
    });
    expect(buildAuditWhere(params({ to: "2026-02-01" })).createdAt).toEqual({
      lte: new Date("2026-02-01"),
    });
  });

  it("ignores invalid dates", () => {
    expect(buildAuditWhere(params({ from: "not-a-date", to: "" }))).toEqual({});
  });

  it("combines every filter dimension", () => {
    const where = buildAuditWhere(
      params({
        action: "login.success",
        userId: "u-1",
        targetId: "t-2",
        from: "2026-01-01",
        to: "2026-02-01",
      }),
    );
    expect(where).toEqual({
      action: "login.success",
      userId: "u-1",
      targetId: "t-2",
      createdAt: { gte: new Date("2026-01-01"), lte: new Date("2026-02-01") },
    });
  });
});

describe("parseAuditFilters", () => {
  it("nulls out absent and invalid fields", () => {
    expect(parseAuditFilters(params({ action: "bogus", from: "nope" }))).toEqual({
      action: null,
      userId: null,
      targetId: null,
      from: null,
      to: null,
    });
  });

  it("preserves valid raw date strings for form repopulation", () => {
    const filters = parseAuditFilters(params({ from: "2026-01-01", to: "2026-02-01" }));
    expect(filters.from).toBe("2026-01-01");
    expect(filters.to).toBe("2026-02-01");
  });
});

describe("activeFilterParams / hasActiveFilters", () => {
  it("reports no active filters for a bare request", () => {
    const filters = parseAuditFilters(params({}));
    expect(hasActiveFilters(filters)).toBe(false);
    expect(activeFilterParams(filters).toString()).toBe("");
  });

  it("serializes only the active filters", () => {
    const filters = parseAuditFilters(params({ action: "logout", userId: "u-1" }));
    expect(hasActiveFilters(filters)).toBe(true);
    const sp = activeFilterParams(filters);
    expect(sp.get("action")).toBe("logout");
    expect(sp.get("userId")).toBe("u-1");
    expect(sp.has("targetId")).toBe(false);
  });
});
