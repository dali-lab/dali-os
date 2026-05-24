import { describe, it, expect } from "vitest";
import {
  parseAuditFilters,
  buildAuditWhere,
  hasAnyFilter,
} from "~/lib/audit-query";

function params(init: Record<string, string>): URLSearchParams {
  return new URLSearchParams(init);
}

describe("parseAuditFilters", () => {
  it("returns an empty object for empty searchParams", () => {
    expect(parseAuditFilters(params({}))).toEqual({});
  });

  it("accepts a known action", () => {
    expect(parseAuditFilters(params({ action: "login.success" }))).toEqual({
      action: "login.success",
    });
  });

  it("drops an unknown action silently", () => {
    expect(parseAuditFilters(params({ action: "not.a.real.action" }))).toEqual({});
  });

  it("treats empty-string filter values as absent", () => {
    expect(
      parseAuditFilters(params({ action: "", userId: "", targetId: "", from: "", to: "" })),
    ).toEqual({});
  });

  it("trims whitespace from id filters", () => {
    expect(parseAuditFilters(params({ userId: "  user-1  ", targetId: " t-2 " }))).toEqual({
      userId: "user-1",
      targetId: "t-2",
    });
  });

  it("parses valid from/to dates", () => {
    const result = parseAuditFilters(
      params({ from: "2026-05-01", to: "2026-05-24" }),
    );
    expect(result.from?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(result.to?.toISOString().slice(0, 10)).toBe("2026-05-24");
  });

  it("drops invalid dates silently", () => {
    expect(parseAuditFilters(params({ from: "garbage", to: "also-bad" }))).toEqual({});
  });

  it("ignores unknown params", () => {
    expect(parseAuditFilters(params({ page: "3", foo: "bar" }))).toEqual({});
  });

  it("combines multiple filters", () => {
    const result = parseAuditFilters(
      params({
        action: "role.change",
        userId: "actor-1",
        targetId: "victim-1",
        from: "2026-05-01",
      }),
    );
    expect(result.action).toBe("role.change");
    expect(result.userId).toBe("actor-1");
    expect(result.targetId).toBe("victim-1");
    expect(result.from).toBeInstanceOf(Date);
    expect(result.to).toBeUndefined();
  });
});

describe("buildAuditWhere", () => {
  it("produces an empty where for no filters", () => {
    expect(buildAuditWhere({})).toEqual({});
  });

  it("maps single-field filters straight through", () => {
    expect(buildAuditWhere({ action: "login.success" })).toEqual({ action: "login.success" });
    expect(buildAuditWhere({ userId: "u-1" })).toEqual({ userId: "u-1" });
    expect(buildAuditWhere({ targetId: "t-1" })).toEqual({ targetId: "t-1" });
  });

  it("collapses from/to into a single createdAt range", () => {
    const from = new Date("2026-05-01");
    const to = new Date("2026-05-24");
    expect(buildAuditWhere({ from, to })).toEqual({ createdAt: { gte: from, lte: to } });
  });

  it("supports a one-sided range", () => {
    const from = new Date("2026-05-01");
    expect(buildAuditWhere({ from })).toEqual({ createdAt: { gte: from } });
  });

  it("composes everything together", () => {
    const from = new Date("2026-05-01");
    expect(
      buildAuditWhere({
        action: "role.change",
        userId: "actor-1",
        targetId: "victim-1",
        from,
      }),
    ).toEqual({
      action: "role.change",
      userId: "actor-1",
      targetId: "victim-1",
      createdAt: { gte: from },
    });
  });
});

describe("hasAnyFilter", () => {
  it("is false for an empty filters object", () => {
    expect(hasAnyFilter({})).toBe(false);
  });

  it("is true when any single field is set", () => {
    expect(hasAnyFilter({ action: "login.success" })).toBe(true);
    expect(hasAnyFilter({ userId: "u-1" })).toBe(true);
    expect(hasAnyFilter({ from: new Date() })).toBe(true);
  });
});
