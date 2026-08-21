import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the audience registry so the roster cache's listMembers is a spy.
vi.mock("~/signing/lib/audiences", () => ({
  AUDIENCE_RESOLVERS: {
    Members: { enumerable: true, listMembers: vi.fn() },
    Manual: { enumerable: false, listMembers: vi.fn() },
  },
}));

import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { computeRoster, makeAudienceRosterCache } from "~/signing/lib/roster.server";

type Sig = Parameters<typeof computeRoster>[1]["signatures"][number];
const sig = (over: Partial<Sig>): Sig => ({
  id: "s",
  roleKey: "member",
  versionId: "v1",
  signerUserId: "u1",
  typedName: null,
  signer: { firstName: "Ada", lastName: "L" },
  ...over,
});

beforeEach(() => vi.resetAllMocks());

describe("computeRoster", () => {
  const audience = [
    { id: "u1", firstName: "Ada", lastName: "L" },
    { id: "u2", firstName: "Bo", lastName: "K" },
    { id: "u3", firstName: "Cy", lastName: "R" },
  ];

  it("splits an enumerable audience into signed + outstanding", () => {
    const r = computeRoster(audience, {
      versionId: "v1",
      signatures: [sig({ id: "s1", signerUserId: "u1", typedName: "Ada L" })],
    });
    expect(r.signed).toEqual([{ name: "Ada L", signatureId: "s1" }]);
    expect(r.outstanding).toEqual(["Bo K", "Cy R"]);
  });

  it("counts only member signatures on the in-force version", () => {
    const r = computeRoster(audience, {
      versionId: "v2",
      signatures: [
        sig({ id: "old", versionId: "v1", signerUserId: "u1" }), // superseded version
        sig({ id: "sup", versionId: "v2", roleKey: "supervisor", signerUserId: "u9" }), // counter-sig
        sig({ id: "ok", versionId: "v2", signerUserId: "u2", typedName: "Bo K" }),
      ],
    });
    expect(r.signed.map((s) => s.signatureId)).toEqual(["ok"]);
    expect(r.outstanding).toEqual(["Ada L", "Cy R"]);
  });

  it("returns outstanding=null for a non-enumerable audience (count only)", () => {
    const r = computeRoster(null, {
      versionId: "v1",
      signatures: [sig({ id: "s1", signerUserId: "u1", typedName: "Ada L" })],
    });
    expect(r.signed).toHaveLength(1);
    expect(r.outstanding).toBeNull();
  });

  it("falls back to the signer's name, then Unknown, when typedName is blank", () => {
    const r = computeRoster(null, {
      versionId: "v1",
      signatures: [
        sig({ id: "s1", signerUserId: "u1", typedName: null, signer: { firstName: "Ada", lastName: "L" } }),
        sig({ id: "s2", signerUserId: "u2", typedName: null, signer: null }),
      ],
    });
    const names = r.signed.map((s) => s.name).sort();
    expect(names).toEqual(["Ada L", "Unknown"]);
  });
});

describe("makeAudienceRosterCache", () => {
  it("resolves each (audience, termId) once and reuses it", async () => {
    const members = [{ id: "u1", firstName: "Ada", lastName: "L" }];
    vi.mocked(AUDIENCE_RESOLVERS.Members.listMembers).mockResolvedValue(members);
    const cache = makeAudienceRosterCache();

    const a = await cache("Members", "t1");
    const b = await cache("Members", "t1");
    expect(a).toBe(b);
    expect(AUDIENCE_RESOLVERS.Members.listMembers).toHaveBeenCalledTimes(1);

    await cache("Members", "t2"); // different term → distinct key
    expect(AUDIENCE_RESOLVERS.Members.listMembers).toHaveBeenCalledTimes(2);
  });

  it("returns null for non-enumerable audiences without querying", async () => {
    const cache = makeAudienceRosterCache();
    expect(await cache("Manual", undefined)).toBeNull();
    expect(AUDIENCE_RESOLVERS.Manual.listMembers).not.toHaveBeenCalled();
  });
});
