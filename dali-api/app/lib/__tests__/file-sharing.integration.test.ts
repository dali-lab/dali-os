import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { addFileShare, removeFileShare } from "~/lib/file-sharing.server";

let fileId: string;
let userId: string;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: "ada@example.edu", firstName: "Ada", lastName: "Lovelace" },
  });
  userId = user.id;
  const file = await prisma.projectFile.create({
    data: { title: "Budget.xlsx", workspaceType: "Member", workspaceId: userId },
  });
  fileId = file.id;
});

describe("FileShare constraints", () => {
  it("defaults a file to Restricted link access at View", async () => {
    const file = await prisma.projectFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file.linkAccess).toBe("Restricted");
    expect(file.linkPermission).toBe("View");
  });

  it("allows one share per file and principal", async () => {
    await prisma.fileShare.create({
      data: { fileId, principalType: "User", principalId: userId, createdById: userId },
    });
    await expect(
      prisma.fileShare.create({
        data: { fileId, principalType: "User", principalId: userId, permission: "Edit", createdById: userId },
      }),
    ).rejects.toThrow();
    expect(await prisma.fileShare.count()).toBe(1);
  });

  it("lets the same principal hold shares on different files and different principal kinds", async () => {
    const other = await prisma.projectFile.create({ data: { title: "Other" } });
    await prisma.fileShare.create({ data: { fileId, principalType: "User", principalId: "p1", createdById: userId } });
    await prisma.fileShare.create({ data: { fileId: other.id, principalType: "User", principalId: "p1", createdById: userId } });
    await prisma.fileShare.create({ data: { fileId, principalType: "Group", principalId: "p1", createdById: userId } });
    expect(await prisma.fileShare.count()).toBe(3);
  });

  it("removes a file's shares when the file is deleted", async () => {
    await prisma.fileShare.create({ data: { fileId, principalType: "User", principalId: userId, createdById: userId } });
    await prisma.projectFile.delete({ where: { id: fileId } });
    expect(await prisma.fileShare.count()).toBe(0);
  });

  it("adds, re-levels and removes through the helpers without duplicating rows", async () => {
    await addFileShare(fileId, userId, "User", userId, "View");
    await addFileShare(fileId, userId, "User", userId, "Edit");
    const rows = await prisma.fileShare.findMany({ where: { fileId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].permission).toBe("Edit");
    expect(await removeFileShare("someone-elses-file", rows[0].id)).toBe(false);
    expect(await removeFileShare(fileId, rows[0].id)).toBe(true);
    expect(await prisma.fileShare.count()).toBe(0);
  });
});
