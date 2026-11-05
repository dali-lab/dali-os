import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/fileAccess.server", () => ({
  canManageFileSharing: vi.fn(),
  canViewFile: vi.fn(),
}));
vi.mock("~/lib/file-sharing.server", () => ({
  addFileShare: vi.fn(),
  removeFileShare: vi.fn(),
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { canManageFileSharing, canViewFile } from "~/lib/fileAccess.server";
import { addFileShare, removeFileShare } from "~/lib/file-sharing.server";
import { notify } from "~/lib/notify.server";
import {
  requireFileShareManager,
  setFileGeneralAccess,
  shareFileWith,
  unshareFile,
  FileShareForbiddenError,
  FileShareNotFoundError,
  FileGeneralAccessError,
} from "../file-share-access.server";

const m = prisma as any;

const FILE = {
  id: "f1",
  title: "Budget.xlsx",
  projectId: null,
  workspaceType: "Lab",
  workspaceId: null,
  folderPageId: "folder-1",
  archivedAt: null,
  linkAccess: "Restricted",
  linkPermission: "View",
  project: null,
  versions: [{ uploadedById: "uploader" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.projectFile.findUnique.mockResolvedValue(FILE);
  m.page.findUnique.mockResolvedValue({ title: "Finance" });
  m.user.findUnique.mockResolvedValue({ id: "uploader", firstName: "Ada", lastName: "Lovelace" });
  vi.mocked(canManageFileSharing).mockResolvedValue(true);
  vi.mocked(canViewFile).mockResolvedValue(true);
  vi.mocked(addFileShare).mockResolvedValue({ ok: true, alreadyShared: false, changed: true });
});

describe("requireFileShareManager", () => {
  it("returns the dialog context with the uploader as owner and the folder as inherited access", async () => {
    const ctx = await requireFileShareManager("f1", "manager");
    expect(ctx).toEqual({
      file: { id: "f1", title: "Budget.xlsx", workspaceType: "Lab" },
      owner: { id: "uploader", name: "Ada Lovelace", isYou: false },
      linkAccess: "Restricted",
      linkPermission: "View",
      inheritedAccess: { kind: "folder", name: "Finance" },
    });
  });

  it("names the owner of a My Drive file and shows no inherited access", async () => {
    m.projectFile.findUnique.mockResolvedValue({ ...FILE, workspaceType: "Member", workspaceId: "me", folderPageId: null });
    m.user.findUnique.mockResolvedValue({ id: "me", firstName: "Grace", lastName: "Hopper" });
    const ctx = await requireFileShareManager("f1", "me");
    expect(ctx.owner).toEqual({ id: "me", name: "Grace Hopper", isYou: true });
    expect(ctx.inheritedAccess).toBeNull();
  });

  it("describes a project file and a loose Lab file", async () => {
    m.projectFile.findUnique.mockResolvedValue({
      ...FILE,
      folderPageId: null,
      projectId: "p1",
      project: { name: "Atlas" },
    });
    expect((await requireFileShareManager("f1", "m")).inheritedAccess).toEqual({ kind: "project", name: "Atlas" });
    m.projectFile.findUnique.mockResolvedValue({ ...FILE, folderPageId: null });
    expect((await requireFileShareManager("f1", "m")).inheritedAccess).toEqual({ kind: "lab", name: "the Lab" });
  });

  it("404s for a missing or archived file", async () => {
    m.projectFile.findUnique.mockResolvedValue(null);
    await expect(requireFileShareManager("f1", "m")).rejects.toBeInstanceOf(FileShareNotFoundError);
    m.projectFile.findUnique.mockResolvedValue({ ...FILE, archivedAt: new Date() });
    await expect(requireFileShareManager("f1", "m")).rejects.toBeInstanceOf(FileShareNotFoundError);
  });

  it("is forbidden for a viewer who cannot manage", async () => {
    vi.mocked(canManageFileSharing).mockResolvedValue(false);
    await expect(requireFileShareManager("f1", "viewer")).rejects.toBeInstanceOf(FileShareForbiddenError);
  });

  it("hides the file from someone who cannot even view it", async () => {
    vi.mocked(canManageFileSharing).mockResolvedValue(false);
    vi.mocked(canViewFile).mockResolvedValue(false);
    await expect(requireFileShareManager("f1", "stranger")).rejects.toBeInstanceOf(FileShareNotFoundError);
  });
});

describe("shareFileWith", () => {
  const args = { fileId: "f1", actorId: "manager", principalType: "User" as const, principalId: "u2", permission: "Edit" as const };

  it("adds the grant, audits it and notifies the person", async () => {
    await shareFileWith(args);
    expect(addFileShare).toHaveBeenCalledWith("f1", "manager", "User", "u2", "Edit");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "projectFile.share",
        userId: "manager",
        targetId: "f1",
        metadata: { principalType: "User", principalId: "u2", permission: "Edit" },
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "document.shared_with_you",
        createdByUserId: "manager",
        message: { vars: { itemTitle: "Budget.xlsx" }, link: "/documents/file/f1" },
        recipients: [{ userId: "u2" }],
      }),
    );
  });

  it("does not write, audit or notify when the caller cannot manage", async () => {
    vi.mocked(canManageFileSharing).mockResolvedValue(false);
    await expect(shareFileWith(args)).rejects.toBeInstanceOf(FileShareForbiddenError);
    expect(addFileShare).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays quiet on an unchanged grant", async () => {
    vi.mocked(addFileShare).mockResolvedValue({ ok: true, alreadyShared: true, changed: false });
    await shareFileWith(args);
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("audits a group grant but notifies nobody", async () => {
    await shareFileWith({ ...args, principalType: "Group", principalId: "g1" });
    expect(logAuditEvent).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify when sharing with yourself", async () => {
    await shareFileWith({ ...args, principalId: "manager" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("tags MCP grants in the audit entry", async () => {
    await shareFileWith({ ...args, via: "mcp" });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ via: "mcp" });
  });
});

describe("unshareFile", () => {
  it("removes the grant and audits it", async () => {
    vi.mocked(removeFileShare).mockResolvedValue(true);
    await unshareFile({ fileId: "f1", actorId: "manager", shareId: "s1" });
    expect(removeFileShare).toHaveBeenCalledWith("f1", "s1");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "projectFile.unshare", targetId: "f1", metadata: { shareId: "s1" } }),
    );
  });

  it("does not audit a share that was already gone", async () => {
    vi.mocked(removeFileShare).mockResolvedValue(false);
    await unshareFile({ fileId: "f1", actorId: "manager", shareId: "stale" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("requires the manager gate", async () => {
    vi.mocked(canManageFileSharing).mockResolvedValue(false);
    await expect(unshareFile({ fileId: "f1", actorId: "viewer", shareId: "s1" })).rejects.toBeInstanceOf(
      FileShareForbiddenError,
    );
    expect(removeFileShare).not.toHaveBeenCalled();
  });
});

describe("setFileGeneralAccess", () => {
  it("opens the file to lab members at the chosen level and audits it", async () => {
    expect(await setFileGeneralAccess("f1", "manager", { linkAccess: "LabMembers", linkPermission: "Edit" })).toEqual({
      linkAccess: "LabMembers",
      linkPermission: "Edit",
    });
    expect(m.projectFile.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { linkAccess: "LabMembers", linkPermission: "Edit" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "projectFile.general-access", targetId: "f1", userId: "manager" }),
    );
  });

  it("resets the level to View when restricting again", async () => {
    expect(await setFileGeneralAccess("f1", "manager", { linkAccess: "Restricted", linkPermission: "Edit" })).toEqual({
      linkAccess: "Restricted",
      linkPermission: "View",
    });
  });

  it.each(["Public", "SignedIn"] as const)("rejects %s access", async (linkAccess) => {
    await expect(
      setFileGeneralAccess("f1", "manager", { linkAccess, linkPermission: "View" }),
    ).rejects.toBeInstanceOf(FileGeneralAccessError);
    expect(m.projectFile.update).not.toHaveBeenCalled();
  });

  it("rejects a link that grants full access", async () => {
    await expect(
      setFileGeneralAccess("f1", "manager", { linkAccess: "LabMembers", linkPermission: "FullAccess" }),
    ).rejects.toThrow("Links can't grant full access");
    expect(m.projectFile.update).not.toHaveBeenCalled();
  });
});
