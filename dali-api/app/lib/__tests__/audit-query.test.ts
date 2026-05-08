import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildAuditWhere,
  encodeCursor,
  parseCursor,
  parseFilters,
  parseLimit,
} from "~/lib/audit-query";

describe("parseLimit", () => {
  it("uses default when missing or invalid", () => {
    expect(parseLimit(null)).toBe(DEFAULT_LIMIT);
    expect(parseLimit("not-a-number")).toBe(DEFAULT_LIMIT);
  });
  it("clamps to [1, MAX_LIMIT]", () => {
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("-50")).toBe(1);
    expect(parseLimit("99999")).toBe(MAX_LIMIT);
    expect(parseLimit("100")).toBe(100);
  });
});

describe("parseCursor / encodeCursor", () => {
  it("round-trips a valid cursor", () => {
    const c = { createdAt: new Date("2026-05-01T12:00:00.000Z"), id: "abc123" };
    const parsed = parseCursor(encodeCursor(c));
    expect(parsed).toEqual(c);
  });
  it("returns null on missing or malformed input", () => {
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor("")).toBeNull();
    expect(parseCursor("no-separator")).toBeNull();
    expect(parseCursor("not-a-date_abc")).toBeNull();
    expect(parseCursor("2026-05-01T12:00:00.000Z_")).toBeNull();
  });
  it("preserves underscores in the id portion (split on the first underscore only)", () => {
    const c = parseCursor("2026-05-01T12:00:00.000Z_abc_def");
    expect(c?.id).toBe("abc_def");
  });
});

describe("parseFilters", () => {
  it("only sets keys that are present and well-formed", () => {
    const params = new URLSearchParams({
      action: "login.success",
      userId: "u1",
      targetId: "t1",
      from: "2026-01-01",
      to: "2026-02-01",
    });
    const f = parseFilters(params);
    expect(f.action).toBe("login.success");
    expect(f.userId).toBe("u1");
    expect(f.targetId).toBe("t1");
    expect(f.from instanceof Date).toBe(true);
    expect(f.to instanceof Date).toBe(true);
  });
  it("ignores invalid dates", () => {
    const f = parseFilters(new URLSearchParams({ from: "not-a-date" }));
    expect(f.from).toBeUndefined();
  });
  it("ignores empty string params", () => {
    const f = parseFilters(new URLSearchParams({ action: "", userId: "" }));
    expect(f.action).toBeUndefined();
    expect(f.userId).toBeUndefined();
  });
});

describe("buildAuditWhere", () => {
  it("returns empty where for no filters and no cursor", () => {
    expect(buildAuditWhere({}, null)).toEqual({});
  });
  it("translates filters to prisma where", () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-02-01");
    const w = buildAuditWhere(
      { action: "login.success", userId: "u1", targetId: "t1", from, to },
      null,
    );
    expect(w).toEqual({
      action: "login.success",
      userId: "u1",
      targetId: "t1",
      createdAt: { gte: from, lte: to },
    });
  });
  it("adds keyset OR clause when a cursor is given", () => {
    const cursor = { createdAt: new Date("2026-05-01T12:00:00.000Z"), id: "x" };
    const w = buildAuditWhere({ action: "logout" }, cursor);
    expect(w.action).toBe("logout");
    expect(w.AND).toEqual([
      {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
    ]);
  });
});
