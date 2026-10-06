import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/dartmouth-people", () => ({
  findNetIdByAddress: vi.fn(async () => null),
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    userEmail: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import { findUserIdByAddress, findUserIdsByAddresses } from "~/lib/user-email.server";

const db = prisma as unknown as { userEmail: { findMany: ReturnType<typeof vi.fn> }; user: { findMany: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
  db.userEmail.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
});

describe("findUserIdsByAddresses", () => {
  it("resolves a UserEmail alias hit", async () => {
    db.userEmail.findMany.mockResolvedValue([{ address: "ada@x.com", userId: "u1" }]);
    const map = await findUserIdsByAddresses(["Ada@X.com"]);
    expect(map.get("ada@x.com")).toBe("u1");
    expect(db.userEmail.findMany).toHaveBeenCalledWith({
      where: { address: { in: ["ada@x.com"] } },
      select: { address: true, userId: true },
    });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("falls back to the legacy identity columns, case-insensitively", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "u2", email: null, daliEmail: "Grace@dali.dartmouth.edu", dartmouthEmail: null, personalEmail: null },
    ]);
    const map = await findUserIdsByAddresses(["grace@dali.dartmouth.edu"]);
    expect(map.get("grace@dali.dartmouth.edu")).toBe("u2");
  });

  it("resolves a <netid>@dartmouth.edu address against User.netId", async () => {
    db.user.findMany
      .mockResolvedValueOnce([]) // legacy-columns pass finds nothing
      .mockResolvedValueOnce([{ id: "u3", netId: "f0abc12" }]); // netId pass
    const map = await findUserIdsByAddresses(["f0abc12@dartmouth.edu"]);
    expect(map.get("f0abc12@dartmouth.edu")).toBe("u3");
  });

  it("normalizes case and whitespace before every lookup", async () => {
    db.userEmail.findMany.mockResolvedValue([{ address: "ada@x.com", userId: "u1" }]);
    const map = await findUserIdsByAddresses(["  ADA@X.COM  "]);
    expect(map.get("ada@x.com")).toBe("u1");
    expect(db.userEmail.findMany).toHaveBeenCalledWith({
      where: { address: { in: ["ada@x.com"] } },
      select: { address: true, userId: true },
    });
  });

  it("returns a map with normalized keys for a batch, omitting addresses nobody owns", async () => {
    db.userEmail.findMany.mockResolvedValue([{ address: "ada@x.com", userId: "u1" }]);
    const map = await findUserIdsByAddresses(["Ada@X.com", "nobody@x.com"]);
    expect([...map.entries()]).toEqual([["ada@x.com", "u1"]]);
  });

  it("returns an empty map for no addresses without querying", async () => {
    const map = await findUserIdsByAddresses([]);
    expect(map.size).toBe(0);
    expect(db.userEmail.findMany).not.toHaveBeenCalled();
  });
});

describe("findUserIdByAddress", () => {
  it("wraps the batch resolver for a single address", async () => {
    db.userEmail.findMany.mockResolvedValue([{ address: "ada@x.com", userId: "u1" }]);
    expect(await findUserIdByAddress("Ada@X.com")).toBe("u1");
  });

  it("returns null when nobody owns the address", async () => {
    expect(await findUserIdByAddress("nobody@x.com")).toBeNull();
  });
});
