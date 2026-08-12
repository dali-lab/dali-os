import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn().mockResolvedValue(false),
  isProjectMember: vi.fn().mockResolvedValue(false),
  isLabMember: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
  isUnderGoverningScope: vi.fn().mockResolvedValue(false),
}));

import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { getPageAccess, isUnderGoverningScope } from "~/lib/pageAccess.server";
import { canViewFile, canEditFile } from "../fileAccess.server";

const denied = { canView: false, canEdit: false, canComment: false, canResolve: false };
const viewOnly = { canView: true, canEdit: false, canComment: true, canResolve: false };
const full = { canView: true, canEdit: true, canComment: true, canResolve: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(isUnderGoverningScope).mockResolvedValue(false);
});

describe("canViewFile", () => {
  it("Member (My Drive) file: owner yes, others no", async () => {
    const file = { workspaceType: "Member", workspaceId: "u1", folderPageId: null };
    expect(await canViewFile("u1", file)).toBe(true);
    expect(await canViewFile("u2", file)).toBe(false);
  });

  it("scoped-folder (Core) file: follows the folder's view access", async () => {
    vi.mocked(isUnderGoverningScope).mockResolvedValue(true);
    const file = { workspaceType: "Lab", workspaceId: null, folderPageId: "core-root" };
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canViewFile("core-user", file)).toBe(true);
    vi.mocked(getPageAccess).mockResolvedValue(denied);
    expect(await canViewFile("lab-user", file)).toBe(false);
  });

  it("unscoped lab/project file: open (no folder scope check)", async () => {
    const labFile = { workspaceType: "Lab", workspaceId: null, folderPageId: null };
    expect(await canViewFile("anyone", labFile)).toBe(true);
    expect(getPageAccess).not.toHaveBeenCalled();
  });
});

describe("canEditFile", () => {
  it("Member file: owner only", async () => {
    const file = { workspaceType: "Member", workspaceId: "u1", folderPageId: null };
    expect(await canEditFile("u1", file)).toBe(true);
    expect(await canEditFile("u2", file)).toBe(false);
  });

  it("scoped-folder file: follows the folder's edit access", async () => {
    vi.mocked(isUnderGoverningScope).mockResolvedValue(true);
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
});
