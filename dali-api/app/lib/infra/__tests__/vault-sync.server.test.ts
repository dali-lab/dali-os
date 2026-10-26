import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, vw, refresh, rosters } = vi.hoisted(() => ({
  prismaMock: { project: { findUnique: vi.fn(), update: vi.fn() } },
  vw: {
    getVaultInventory: vi.fn(),
    syncGroup: vi.fn(),
    setGroupCollections: vi.fn(),
    findGroupByExternalId: vi.fn(),
    VaultwardenError: class extends Error {},
  },
  refresh: vi.fn(),
  rosters: vi.fn(),
}));
vi.mock("~/lib/db", () => ({ prisma: prismaMock }));
vi.mock("~/jobs/infra-snapshot.server", () => ({ refreshVaultSnapshot: refresh }));
vi.mock("../vaultwarden.server", () => vw);
vi.mock("../vault-read.server", () => ({ loadVaultRosters: rosters }));

import { createProjectVaultGroup, syncProjectVault } from "../vault-sync.server";

const inventory = (externalId: string | null) => ({
  orgId: "org",
  members: [
    { id: "m1", email: "ada@example.edu", name: null, status: 2, type: 2, twoFactorEnabled: true },
    { id: "m2", email: "alan@example.edu", name: null, status: 2, type: 2, twoFactorEnabled: true },
  ],
  groups: [{ id: "g1", name: "Ultrasound", externalId, memberIds: ["m1", "m2"], collectionIds: ["c1"] }],
  collections: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  refresh.mockResolvedValue(true);
  prismaMock.project.findUnique.mockResolvedValue({ id: "p1", name: "Ultrasound", vaultwardenGroupId: "g1" });
  rosters.mockResolvedValue(
    new Map([
      [
        "p1",
        [
          { userId: "u1", name: "Ada", email: "ada@example.edu" },
          { userId: "u2", name: "Grace", email: "grace@example.edu" },
          { userId: "u3", name: "Mary", email: null },
        ],
      ],
    ]),
  );
});

describe("syncProjectVault", () => {
  it("adds staffed people and keeps current members", async () => {
    vw.getVaultInventory.mockResolvedValue(inventory("dali-project:p1"));
    expect(await syncProjectVault("p1")).toEqual({ added: 1, removed: 0, noEmail: 1 });
    const call = vw.syncGroup.mock.calls[0][0];
    expect(call).toMatchObject({ externalId: "dali-project:p1", name: "Ultrasound" });
    expect([...call.emails].sort()).toEqual(["ada@example.edu", "alan@example.edu", "grace@example.edu"]);
    expect(vw.setGroupCollections).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("removes only the people asked for", async () => {
    vw.getVaultInventory.mockResolvedValue(inventory("dali-project:p1"));
    expect((await syncProjectVault("p1", { remove: ["alan@example.edu"] })).removed).toBe(1);
    expect([...vw.syncGroup.mock.calls[0][0].emails].sort()).toEqual(["ada@example.edu", "grace@example.edu"]);
  });

  it("stamps an external id on a hand-made group before importing", async () => {
    vw.getVaultInventory.mockResolvedValue(inventory(null));
    await syncProjectVault("p1");
    expect(vw.setGroupCollections).toHaveBeenCalledWith(
      expect.objectContaining({ id: "g1", externalId: "dali-project:p1", memberIds: ["m1", "m2"] }),
      ["c1"],
    );
    expect(vw.syncGroup.mock.calls[0][0].externalId).toBe("dali-project:p1");
    expect(vw.setGroupCollections.mock.invocationCallOrder[0]).toBeLessThan(vw.syncGroup.mock.invocationCallOrder[0]);
  });

  it("keeps a group's existing external id", async () => {
    vw.getVaultInventory.mockResolvedValue(inventory("from-another-tool"));
    await syncProjectVault("p1");
    expect(vw.syncGroup.mock.calls[0][0].externalId).toBe("from-another-tool");
  });

  it("refuses a project with no linked group", async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: "p1", vaultwardenGroupId: null });
    await expect(syncProjectVault("p1")).rejects.toThrow("No Vaultwarden group is linked");
    expect(vw.syncGroup).not.toHaveBeenCalled();
  });

  it("refuses when the linked group is gone", async () => {
    vw.getVaultInventory.mockResolvedValue({ ...inventory(null), groups: [] });
    await expect(syncProjectVault("p1")).rejects.toThrow("no longer exists");
  });
});

describe("createProjectVaultGroup", () => {
  it("creates a group named after the project with its staffed people and links it", async () => {
    vw.findGroupByExternalId.mockResolvedValue({ id: "g-new", name: "Ultrasound" });
    expect(await createProjectVaultGroup("p1")).toBe("g-new");
    expect(vw.syncGroup).toHaveBeenCalledWith({
      externalId: "dali-project:p1",
      name: "Ultrasound",
      emails: ["ada@example.edu", "grace@example.edu"],
    });
    expect(prismaMock.project.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { vaultwardenGroupId: "g-new" } });
  });

  it("explains a group that didn't appear", async () => {
    vw.findGroupByExternalId.mockResolvedValue(null);
    await expect(createProjectVaultGroup("p1")).rejects.toThrow("ORG_GROUPS_ENABLED");
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });
});
