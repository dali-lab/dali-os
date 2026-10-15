import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn().mockResolvedValue(false),
  isProjectMember: vi.fn().mockResolvedValue(false),
  isLabMember: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canViewFile, canEditFile } from "../fileAccess.server";

const denied = { canView: false, canEdit: false, canComment: false };
const viewOnly = { canView: true, canEdit: false, canComment: true };
const full = { canView: true, canEdit: true, canComment: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
});

describe("canViewFile", () => {
  it("Member (My Drive) file: owner yes, others no", async () => {
    const file = { workspaceType: "Member", workspaceId: "u1", folderPageId: null };
    expect(await canViewFile("u1", file)).toBe(true);
    expect(await canViewFile("u2", file)).toBe(false);
  });

  it("folder file: follows the folder's view access", async () => {
    const file = { workspaceType: "Lab", workspaceId: null, folderPageId: "core-root" };
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canViewFile("core-user", file)).toBe(true);
    vi.mocked(getPageAccess).mockResolvedValue(denied);
    expect(await canViewFile("lab-user", file)).toBe(false);
  });

  it("file in an unscoped lab folder the viewer can view: viewable", async () => {
    const file = { workspaceType: "Lab", workspaceId: null, folderPageId: "plain-folder" };
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canViewFile("labber", file)).toBe(true);
    expect(getPageAccess).toHaveBeenCalledWith("labber", "plain-folder", undefined);
  });

  it("file in a Restricted lab folder the viewer cannot view: not viewable", async () => {
    const file = { workspaceType: "Lab", workspaceId: null, folderPageId: "restricted-folder" };
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(getPageAccess).mockResolvedValue(denied);
    expect(await canViewFile("labber", file)).toBe(false);
  });

  it("file in a project folder: viewable by a lab member via the folder", async () => {
    const file = { projectId: "p1", workspaceType: null, workspaceId: null, folderPageId: "proj-folder" };
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canViewFile("labber", file)).toBe(true);
  });

  it("loose lab-root file: viewable by a lab member, not by a non-member", async () => {
    const file = { workspaceType: "Lab", workspaceId: null, folderPageId: null };
    expect(await canViewFile("outsider", file)).toBe(false);
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canViewFile("labber", file)).toBe(true);
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("loose project file: viewable by a lab member, not by a non-member", async () => {
    const file = { projectId: "p1", workspaceType: null, workspaceId: null, folderPageId: null };
    expect(await canViewFile("outsider", file)).toBe(false);
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canViewFile("labber", file)).toBe(true);
  });

  it("forwards the request so role checks stay memoised per navigation", async () => {
    const request = new Request("http://localhost/");
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    await canViewFile("u", { folderPageId: "f" }, request);
    expect(getPageAccess).toHaveBeenCalledWith("u", "f", request);
    await canViewFile("u", { workspaceType: "Lab", folderPageId: null }, request);
    expect(isLabMember).toHaveBeenCalledWith("u", request);
  });
});

describe("canEditFile", () => {
  it("Member file: owner only", async () => {
    const file = { workspaceType: "Member", workspaceId: "u1", folderPageId: null };
    expect(await canEditFile("u1", file)).toBe(true);
    expect(await canEditFile("u2", file)).toBe(false);
  });

  it("folder file: follows the folder's edit access", async () => {
    const file = { workspaceType: "Lab", workspaceId: null, folderPageId: "core-root" };
    vi.mocked(getPageAccess).mockResolvedValue(full);
    expect(await canEditFile("core-user", file)).toBe(true);
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canEditFile("commenter", file)).toBe(false);
  });

  it("project file: Core or project member", async () => {
    const file = { projectId: "p1", workspaceType: null, workspaceId: null, folderPageId: null };
    expect(await canEditFile("stranger", file)).toBe(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    expect(await canEditFile("member", file)).toBe(true);
  });

  it("lab-root file: any lab member", async () => {
    const file = { workspaceType: "Lab", workspaceId: null, folderPageId: null };
    expect(await canEditFile("outsider", file)).toBe(false);
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canEditFile("labber", file)).toBe(true);
  });

  it("file in a project folder: editable by a project member or Core, not by a lab member", async () => {
    const file = { projectId: "p1", workspaceType: null, workspaceId: null, folderPageId: "proj-folder" };
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canEditFile("labber", file)).toBe(false);
    vi.mocked(getPageAccess).mockResolvedValue(full);
    expect(await canEditFile("member", file)).toBe(true);
    expect(await canEditFile("core", file)).toBe(true);
  });

  it("loose project file: editable by Core or a project member only", async () => {
    const file = { projectId: "p1", workspaceType: null, workspaceId: null, folderPageId: null };
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canEditFile("labber", file)).toBe(false);
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await canEditFile("core", file)).toBe(true);
  });

  it("file with no folder, project or workspace: not editable", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canEditFile("labber", { folderPageId: null })).toBe(false);
  });
});
