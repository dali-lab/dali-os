import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  Prisma: {},
  prisma: {
    form: { create: vi.fn(), update: vi.fn() },
    page: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    pageShare: { deleteMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "~/lib/db.server";
import {
  createForm,
  deleteForm,
  linkAccessForAudience,
  moveForm,
  renameForm,
  setFormArchived,
  setFormAudience,
} from "~/forms/lib/form-page.server";

const db = prisma as unknown as {
  form: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  pageShare: { deleteMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockResolvedValue([]);
  db.page.findFirst.mockResolvedValue(null);
  db.form.create.mockResolvedValue({ id: "f1" });
});

describe("linkAccessForAudience", () => {
  it.each([
    ["Public", "Public"],
    ["Members", "LabMembers"],
    ["SignedIn", "SignedIn"],
    ["Groups", "Restricted"],
  ] as const)("%s audience becomes %s general access", (audience, access) => {
    expect(linkAccessForAudience(audience)).toBe(access);
  });
});

describe("createForm", () => {
  it("nests a Form page in the folder's workspace, titled by the form's name", async () => {
    db.page.findUnique.mockResolvedValue({ workspaceType: "Project", workspaceId: "proj-1" });
    db.page.findFirst.mockResolvedValue({ position: 4 });

    await createForm({ name: "Intake", createdById: "u1", folderPageId: "folder-1" }, { id: true });

    expect(db.form.create).toHaveBeenCalledTimes(1);
    const arg = db.form.create.mock.calls[0][0];
    expect(arg.select).toEqual({ id: true });
    expect(arg.data).toMatchObject({
      name: "Intake",
      folderPageId: "folder-1",
      createdBy: { connect: { id: "u1" } },
    });
    expect(arg.data.page.create).toMatchObject({
      workspaceType: "Project",
      workspaceId: "proj-1",
      parentPageId: "folder-1",
      title: "Intake",
      kind: "Form",
      position: 5,
      createdById: "u1",
      linkAccess: "LabMembers",
      linkPermission: "View",
      shares: undefined,
    });
  });

  it("files an unplaced form in the Lab workspace at the top level", async () => {
    await createForm({ name: "Loose", createdById: "u1" });

    const page = db.form.create.mock.calls[0][0].data.page.create;
    expect(db.page.findUnique).not.toHaveBeenCalled();
    expect(page).toMatchObject({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      position: 0,
    });
  });

  it("falls back to the Lab workspace when the folder cannot be found", async () => {
    db.page.findUnique.mockResolvedValue(null);

    await createForm({ name: "Lost", createdById: "u1", folderPageId: "gone" });

    expect(db.form.create.mock.calls[0][0].data.page.create).toMatchObject({
      workspaceType: "Lab",
      workspaceId: null,
    });
  });

  it("passes the rest of the form data through untouched", async () => {
    await createForm({
      name: "Template",
      createdById: "u1",
      templateKey: "k",
      published: true,
      versions: { create: { versionNumber: 1, questions: [], createdById: "u1" } },
    });

    expect(db.form.create.mock.calls[0][0].data).toMatchObject({
      templateKey: "k",
      published: true,
      versions: { create: { versionNumber: 1 } },
    });
  });

  it("gives each group a View share when the audience is Groups", async () => {
    await createForm({
      name: "Staff only",
      createdById: "u1",
      audience: "Groups",
      audienceGroupIds: ["g1", "g2"],
    });

    const page = db.form.create.mock.calls[0][0].data.page.create;
    expect(page.linkAccess).toBe("Restricted");
    expect(page.shares).toEqual({
      create: [
        { principalType: "Group", principalId: "g1", permission: "View", createdById: "u1" },
        { principalType: "Group", principalId: "g2", permission: "View", createdById: "u1" },
      ],
    });
  });

  it("creates no shares for a broad audience", async () => {
    await createForm({ name: "Open", createdById: "u1", audience: "Public" });

    const page = db.form.create.mock.calls[0][0].data.page.create;
    expect(page.linkAccess).toBe("Public");
    expect(page.shares).toBeUndefined();
  });

  it("carries a trashed state onto the page", async () => {
    const archivedAt = new Date("2026-01-01T00:00:00Z");
    await createForm({ name: "Old", createdById: "u1", archivedAt });
    expect(db.form.create.mock.calls[0][0].data.page.create.archivedAt).toBe(archivedAt);
  });
});

describe("renameForm", () => {
  it("renames the form and its page together", async () => {
    await renameForm("f1", "New name");

    expect(db.form.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { name: "New name" } });
    expect(db.page.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { title: "New name" } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("moveForm", () => {
  it("re-parents the page into the destination folder's workspace", async () => {
    db.page.findUnique.mockResolvedValue({ workspaceType: "EducationOffering", workspaceId: "off-1" });
    db.page.findFirst.mockResolvedValue({ position: 1 });

    await moveForm("f1", "folder-2");

    expect(db.form.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { folderPageId: "folder-2" } });
    expect(db.page.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { parentPageId: "folder-2", workspaceType: "EducationOffering", workspaceId: "off-1", position: 2 },
    });
  });

  it("moves to the Lab top level when no folder is given", async () => {
    await moveForm("f1", null);

    expect(db.form.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { folderPageId: null } });
    expect(db.page.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { parentPageId: null, workspaceType: "Lab", workspaceId: null, position: 0 },
    });
  });
});

describe("setFormArchived", () => {
  it("trashes and restores both rows with the same value", async () => {
    const at = new Date();
    await setFormArchived("f1", at);
    expect(db.form.update).toHaveBeenLastCalledWith({ where: { id: "f1" }, data: { archivedAt: at } });
    expect(db.page.update).toHaveBeenLastCalledWith({ where: { id: "f1" }, data: { archivedAt: at } });

    await setFormArchived("f1", null);
    expect(db.form.update).toHaveBeenLastCalledWith({ where: { id: "f1" }, data: { archivedAt: null } });
    expect(db.page.update).toHaveBeenLastCalledWith({ where: { id: "f1" }, data: { archivedAt: null } });
  });
});

describe("deleteForm", () => {
  it("deletes the page, which cascades to the form", async () => {
    await deleteForm("f1");
    expect(db.page.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });
});

describe("setFormAudience", () => {
  it("keeps the listed groups, drops the others, and mirrors general access", async () => {
    await setFormAudience("f1", "Groups", ["g1", "g2", "g1"], "actor");

    expect(db.form.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { audience: "Groups", audienceGroupIds: ["g1", "g2"] },
    });
    expect(db.page.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { linkAccess: "Restricted", linkPermission: "View" },
    });
    expect(db.pageShare.deleteMany).toHaveBeenCalledWith({
      where: { pageId: "f1", principalType: "Group", principalId: { notIn: ["g1", "g2"] } },
    });
    expect(db.pageShare.upsert).toHaveBeenCalledTimes(2);
    expect(db.pageShare.upsert).toHaveBeenCalledWith({
      where: { pageId_principalType_principalId: { pageId: "f1", principalType: "Group", principalId: "g2" } },
      update: { permission: "View" },
      create: { pageId: "f1", principalType: "Group", principalId: "g2", permission: "View", createdById: "actor" },
    });
  });

  it("removes every group share and clears the ids when leaving Groups", async () => {
    await setFormAudience("f1", "Members", ["g1"], "actor");

    expect(db.form.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { audience: "Members", audienceGroupIds: [] },
    });
    expect(db.page.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { linkAccess: "LabMembers", linkPermission: "View" },
    });
    expect(db.pageShare.deleteMany).toHaveBeenCalledWith({
      where: { pageId: "f1", principalType: "Group" },
    });
    expect(db.pageShare.upsert).not.toHaveBeenCalled();
  });
});
