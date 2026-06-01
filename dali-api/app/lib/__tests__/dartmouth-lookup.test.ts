import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDcDeptclass, lookupByNetId } from "~/lib/dartmouth-lookup";

describe("parseDcDeptclass", () => {
  it("parses apostrophe-prefixed 2000s years", () => {
    expect(parseDcDeptclass("'27")).toBe(2027);
    expect(parseDcDeptclass("'00")).toBe(2000);
    expect(parseDcDeptclass("'26")).toBe(2026);
  });

  it("parses '90+ as 1990s", () => {
    expect(parseDcDeptclass("'95")).toBe(1995);
    expect(parseDcDeptclass("'99")).toBe(1999);
  });

  it("returns null for department strings", () => {
    expect(parseDcDeptclass("Physiology")).toBeNull();
    expect(parseDcDeptclass("Magnuson Center")).toBeNull();
    expect(parseDcDeptclass("CTBH")).toBeNull();
  });

  it("returns null for empty / nullish input", () => {
    expect(parseDcDeptclass(null)).toBeNull();
    expect(parseDcDeptclass(undefined)).toBeNull();
    expect(parseDcDeptclass("")).toBeNull();
  });

  it("returns null for malformed apostrophe input", () => {
    expect(parseDcDeptclass("'2027")).toBeNull();
    expect(parseDcDeptclass("'A2")).toBeNull();
    expect(parseDcDeptclass("27")).toBeNull();
  });
});

describe("lookupByNetId", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockJson(body: unknown, init: ResponseInit = { status: 200 }) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), init),
    );
  }

  it("returns affiliation + classYear for a Student match", async () => {
    mockJson({
      status: "200",
      users: [
        {
          uid: "f006v43",
          eduPersonPrimaryAffiliation: "Student",
          dcDeptclass: "'27",
        },
      ],
      truncated: false,
    });
    const r = await lookupByNetId("f006v43");
    expect(r).toEqual({ affiliation: "Student", classYear: 2027 });
  });

  it("returns affiliation but null classYear for Staff (dept name in dcDeptclass)", async () => {
    mockJson({
      users: [
        {
          uid: "d1207c2",
          eduPersonPrimaryAffiliation: "Staff",
          dcDeptclass: "Magnuson Center",
        },
      ],
    });
    const r = await lookupByNetId("d1207c2");
    expect(r).toEqual({ affiliation: "Staff", classYear: null });
  });

  it("returns null when no users array is present", async () => {
    mockJson({ status: "200", users: [] });
    expect(await lookupByNetId("nobody")).toBeNull();
  });

  it("matches strictly on uid, ignoring name-substring hits", async () => {
    // Lookup may return many users when searching by string; if none has the
    // exact uid we want, we treat the user as absent.
    mockJson({
      users: [
        {
          uid: "different",
          eduPersonPrimaryAffiliation: "Student",
          dcDeptclass: "'27",
        },
      ],
    });
    expect(await lookupByNetId("f006v43")).toBeNull();
  });

  it("throws on non-OK HTTP status", async () => {
    mockJson({}, { status: 503, statusText: "Service Unavailable" });
    await expect(lookupByNetId("anyone")).rejects.toThrow(/503/);
  });
});
