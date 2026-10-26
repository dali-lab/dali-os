import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, currentTerm } = vi.hoisted(() => ({
  prismaMock: { projectAssignment: { findMany: vi.fn() }, infraSnapshot: { findFirst: vi.fn() } },
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/db", () => ({ prisma: prismaMock }));
vi.mock("~/lib/roles", () => ({ currentTerm }));

import { latestVaultInventory, loadVaultRosters } from "../vault-read.server";

beforeEach(() => vi.clearAllMocks());

const row = (projectId: string, id: string, daliEmail: string | null) => ({
  projectId,
  user: { id, firstName: "Ada", lastName: "Lovelace", daliEmail },
});

describe("loadVaultRosters", () => {
  it("dedupes people staffed in several domains and lowercases DALI emails", async () => {
    currentTerm.mockResolvedValue({ id: "t26f" });
    prismaMock.projectAssignment.findMany.mockResolvedValue([
      row("p1", "u1", " Ada@Example.edu "),
      row("p1", "u1", "ada@example.edu"),
      row("p1", "u2", null),
    ]);
    const out = await loadVaultRosters(["p1", "p2"]);
    expect(out.get("p1")).toEqual([
      { userId: "u1", name: "Ada Lovelace", email: "ada@example.edu" },
      { userId: "u2", name: "Ada Lovelace", email: null },
    ]);
    expect(out.get("p2")).toEqual([]);
    expect(prismaMock.projectAssignment.findMany.mock.calls[0][0].where).toEqual({
      termId: "t26f",
      projectId: { in: ["p1", "p2"] },
    });
  });

  it("is empty without projects or a current term", async () => {
    expect((await loadVaultRosters([])).size).toBe(0);
    currentTerm.mockResolvedValue(null);
    expect((await loadVaultRosters(["p1"])).get("p1")).toEqual([]);
    expect(prismaMock.projectAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("latestVaultInventory", () => {
  it("reads the org snapshot", async () => {
    prismaMock.infraSnapshot.findFirst.mockResolvedValue({ payload: { orgId: "org" } });
    expect(await latestVaultInventory()).toEqual({ orgId: "org" });
    expect(prismaMock.infraSnapshot.findFirst.mock.calls[0][0].where).toEqual({ projectId: "vaultwarden-org", provider: "vaultwarden" });
  });

  it("is null before the first sweep", async () => {
    prismaMock.infraSnapshot.findFirst.mockResolvedValue(null);
    expect(await latestVaultInventory()).toBeNull();
  });
});
