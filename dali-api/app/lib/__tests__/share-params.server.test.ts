import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/groups", () => ({ listVisibleGroupsForUser: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { listVisibleGroupsForUser } from "~/lib/groups";
import { loadShareOptions, parseLinkAccess, parsePermission } from "../share-params.server";

const m = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  m.user.findMany.mockResolvedValue([{ id: "u2", firstName: "Ada", lastName: "Lovelace" }]);
  vi.mocked(listVisibleGroupsForUser).mockResolvedValue([{ id: "g1", name: "Studio" }] as never);
});

describe("parsePermission and parseLinkAccess", () => {
  it("accepts known values and falls back otherwise", () => {
    expect(parsePermission("Edit")).toBe("Edit");
    expect(parsePermission("Owner")).toBe("View");
    expect(parsePermission(undefined, "Comment")).toBe("Comment");
    expect(parseLinkAccess("LabMembers")).toBe("LabMembers");
    expect(parseLinkAccess("Everyone")).toBe("Restricted");
  });
});

describe("loadShareOptions", () => {
  it("searches members by name, excluding the caller and non-members, capped at 8", async () => {
    const res = await loadShareOptions("me", "ada");
    expect(m.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 8,
        where: expect.objectContaining({ id: { not: "me" }, daliMember: { isNot: null } }),
      }),
    );
    expect(res).toEqual({
      members: [{ id: "u2", label: "Ada Lovelace" }],
      groups: [{ id: "g1", label: "Studio" }],
    });
  });

  it("does not list members for a query under two characters", async () => {
    const res = await loadShareOptions("me", "a");
    expect(m.user.findMany).not.toHaveBeenCalled();
    expect(res.members).toEqual([]);
    expect(res.groups).toHaveLength(1);
  });
});
