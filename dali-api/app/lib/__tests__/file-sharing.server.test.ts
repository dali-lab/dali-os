import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn().mockResolvedValue(["a", "b"]),
  listVisibleGroupIdsForUser: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { listVisibleGroupIdsForUser } from "~/lib/groups";
import {
  addFileShare,
  listFileShares,
  removeFileShare,
  sharePermissionForFile,
} from "../file-sharing.server";
import { SharePrincipalError } from "../page-sharing.server";

const m = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([]);
  m.fileShare.findMany.mockResolvedValue([]);
  m.fileShare.deleteMany.mockResolvedValue({ count: 0 });
});

describe("sharePermissionForFile", () => {
  it("is null when nothing is shared with the user", async () => {
    expect(await sharePermissionForFile("f1", "u1")).toBeNull();
  });

  it("looks up the user directly and through their non-archived groups", async () => {
    vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([
      { id: "g1", archivedAt: null },
      { id: "g-old", archivedAt: new Date() },
    ] as never);
    await sharePermissionForFile("f1", "u1");
    expect(m.fileShare.findMany.mock.calls[0][0].where).toEqual({
      fileId: "f1",
      OR: [
        { principalType: "User", principalId: "u1" },
        { principalType: "Group", principalId: { in: ["g1"] } },
      ],
    });
  });

  it("returns the highest level when a user and a group both grant", async () => {
    m.fileShare.findMany.mockResolvedValue([{ permission: "View" }, { permission: "Edit" }, { permission: "Comment" }]);
    expect(await sharePermissionForFile("f1", "u1")).toBe("Edit");
  });
});

describe("listFileShares", () => {
  it("is empty without a share", async () => {
    expect(await listFileShares("f1")).toEqual([]);
  });

  it("labels people and groups, and sizes groups", async () => {
    m.fileShare.findMany.mockResolvedValue([
      { id: "s1", principalType: "User", principalId: "u2", permission: "View" },
      { id: "s2", principalType: "Group", principalId: "g1", permission: "Edit" },
    ]);
    m.user.findMany.mockResolvedValue([{ id: "u2", firstName: "Ada", lastName: "Lovelace" }]);
    m.groupDefinition.findMany.mockResolvedValue([{ id: "g1", name: "Studio" }]);

    expect(await listFileShares("f1")).toEqual([
      { id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Ada Lovelace" },
      { id: "s2", principalType: "Group", principalId: "g1", permission: "Edit", label: "Studio", memberCount: 2 },
    ]);
    expect(m.fileShare.findMany.mock.calls[0][0].where).toEqual({ fileId: "f1" });
  });
});

describe("addFileShare", () => {
  it("creates a grant for an existing member", async () => {
    m.user.findUnique.mockResolvedValue({ id: "u2" });
    m.fileShare.findUnique.mockResolvedValue(null);
    expect(await addFileShare("f1", "actor", "User", "u2", "Edit")).toEqual({
      ok: true,
      alreadyShared: false,
      changed: true,
    });
    expect(m.fileShare.create).toHaveBeenCalledWith({
      data: { fileId: "f1", principalType: "User", principalId: "u2", permission: "Edit", createdById: "actor" },
    });
  });

  it("rejects an unknown member without writing", async () => {
    m.user.findUnique.mockResolvedValue(null);
    await expect(addFileShare("f1", "actor", "User", "ghost")).rejects.toBeInstanceOf(SharePrincipalError);
    expect(m.fileShare.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown or archived group", async () => {
    m.groupDefinition.findUnique.mockResolvedValue(null);
    await expect(addFileShare("f1", "actor", "Group", "gone")).rejects.toThrow("That group no longer exists");
    m.groupDefinition.findUnique.mockResolvedValue({ id: "g1", archivedAt: new Date() });
    await expect(addFileShare("f1", "actor", "Group", "g1")).rejects.toThrow("That group is archived");
    expect(m.fileShare.create).not.toHaveBeenCalled();
  });

  it("is a quiet no-op when the same level is added again", async () => {
    m.user.findUnique.mockResolvedValue({ id: "u2" });
    m.fileShare.findUnique.mockResolvedValue({ id: "s1", permission: "View" });
    expect(await addFileShare("f1", "actor", "User", "u2", "View")).toEqual({
      ok: true,
      alreadyShared: true,
      changed: false,
    });
    expect(m.fileShare.update).not.toHaveBeenCalled();
    expect(m.fileShare.create).not.toHaveBeenCalled();
  });

  it("changes the level of an existing grant", async () => {
    m.user.findUnique.mockResolvedValue({ id: "u2" });
    m.fileShare.findUnique.mockResolvedValue({ id: "s1", permission: "View" });
    expect(await addFileShare("f1", "actor", "User", "u2", "Edit")).toEqual({
      ok: true,
      alreadyShared: true,
      changed: true,
    });
    expect(m.fileShare.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { permission: "Edit" } });
  });

  it("defaults to View", async () => {
    m.user.findUnique.mockResolvedValue({ id: "u2" });
    m.fileShare.findUnique.mockResolvedValue(null);
    await addFileShare("f1", "actor", "User", "u2");
    expect(m.fileShare.create.mock.calls[0][0].data.permission).toBe("View");
  });
});

describe("removeFileShare", () => {
  it("scopes the delete to the file and reports whether a row went", async () => {
    m.fileShare.deleteMany.mockResolvedValue({ count: 1 });
    expect(await removeFileShare("f1", "s1")).toBe(true);
    expect(m.fileShare.deleteMany).toHaveBeenCalledWith({ where: { id: "s1", fileId: "f1" } });
    m.fileShare.deleteMany.mockResolvedValue({ count: 0 });
    expect(await removeFileShare("f1", "stale")).toBe(false);
  });
});
