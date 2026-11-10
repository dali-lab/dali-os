import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
  isLabMember: vi.fn(),
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/file-sharing.server", () => ({ sharePermissionForFile: vi.fn() }));

import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { sharePermissionForFile } from "~/lib/file-sharing.server";
import {
  canViewFile,
  canEditFile,
  canManageFileSharing,
  filterViewableFiles,
} from "../fileAccess.server";

const denied = { canView: false, canEdit: false, canComment: false };
const viewOnly = { canView: true, canEdit: false, canComment: true };
const full = { canView: true, canEdit: true, canComment: true };

const inFolder = (extra = {}) => ({
  id: "f1",
  workspaceType: "Lab",
  workspaceId: null,
  folderPageId: "core-folder",
  ...extra,
});
const myDrive = (extra = {}) => ({ id: "f1", workspaceType: "Member", workspaceId: "owner", folderPageId: null, ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(getPageAccess).mockResolvedValue(denied);
  vi.mocked(sharePermissionForFile).mockResolvedValue(null);
});

describe("file access matrix: view", () => {
  it("owner of a My Drive file", async () => {
    expect(await canViewFile("owner", myDrive())).toBe(true);
    expect(sharePermissionForFile).not.toHaveBeenCalled();
  });

  it("a stranger to a My Drive file", async () => {
    expect(await canViewFile("stranger", myDrive())).toBe(false);
  });

  it("a folder viewer, with no share on the file", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canViewFile("viewer", inFolder())).toBe(true);
    expect(sharePermissionForFile).not.toHaveBeenCalled();
  });

  it.each(["View", "Comment", "Edit", "FullAccess"] as const)(
    "a %s named share opens a file the folder hides",
    async (level) => {
      vi.mocked(sharePermissionForFile).mockResolvedValue(level);
      expect(await canViewFile("sharee", inFolder())).toBe(true);
      expect(sharePermissionForFile).toHaveBeenCalledWith("f1", "sharee", undefined);
    },
  );

  it("a named share opens a My Drive file for someone other than the owner", async () => {
    vi.mocked(sharePermissionForFile).mockResolvedValue("View");
    expect(await canViewFile("sharee", myDrive())).toBe(true);
  });

  it("link access for lab members opens the file to lab members only", async () => {
    const file = inFolder({ linkAccess: "LabMembers", linkPermission: "View" });
    expect(await canViewFile("outsider", file)).toBe(false);
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canViewFile("labber", file)).toBe(true);
  });

  it("link access for signed-in accounts opens the file to anyone signed in", async () => {
    expect(await canViewFile("anyone", inFolder({ linkAccess: "SignedIn", linkPermission: "View" }))).toBe(true);
  });

  it("a file left Restricted stays closed to a stranger", async () => {
    expect(await canViewFile("stranger", inFolder({ linkAccess: "Restricted" }))).toBe(false);
  });

  it("without a file id only inherited access applies", async () => {
    vi.mocked(sharePermissionForFile).mockResolvedValue("FullAccess");
    const { id: _id, ...noId } = inFolder({ linkAccess: "LabMembers" });
    expect(await canViewFile("sharee", noId)).toBe(false);
    expect(sharePermissionForFile).not.toHaveBeenCalled();
  });

  it("forwards the request when resolving a share", async () => {
    const request = new Request("http://localhost/");
    await canViewFile("u", inFolder(), request);
    expect(sharePermissionForFile).toHaveBeenCalledWith("f1", "u", request);
  });
});

describe("file access matrix: edit", () => {
  it("owner of a My Drive file", async () => {
    expect(await canEditFile("owner", myDrive())).toBe(true);
  });

  it("a stranger", async () => {
    expect(await canEditFile("stranger", inFolder())).toBe(false);
  });

  it("a folder viewer cannot edit", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canEditFile("viewer", inFolder())).toBe(false);
  });

  it("a folder editor can edit", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(full);
    expect(await canEditFile("editor", inFolder())).toBe(true);
  });

  it.each([
    ["View", false],
    ["Comment", false],
    ["Edit", true],
    ["FullAccess", true],
  ] as const)("a %s named share: can edit is %s", async (level, expected) => {
    vi.mocked(sharePermissionForFile).mockResolvedValue(level);
    expect(await canEditFile("sharee", inFolder())).toBe(expected);
  });

  it("an edit share on a group the user belongs to counts like a direct one", async () => {
    vi.mocked(sharePermissionForFile).mockResolvedValue("Edit");
    expect(await canEditFile("grouped", inFolder())).toBe(true);
  });

  it("link access at Edit lets lab members edit; at View it does not", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canEditFile("labber", inFolder({ linkAccess: "LabMembers", linkPermission: "Edit" }))).toBe(true);
    expect(await canEditFile("labber", inFolder({ linkAccess: "LabMembers", linkPermission: "View" }))).toBe(false);
  });

  it("a lower named share never takes away inherited edit access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(full);
    vi.mocked(sharePermissionForFile).mockResolvedValue("View");
    expect(await canEditFile("editor", inFolder())).toBe(true);
    expect(await canViewFile("editor", inFolder())).toBe(true);
  });

  it("a link at View never lowers a named Edit share", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(sharePermissionForFile).mockResolvedValue("Edit");
    expect(await canEditFile("labber", inFolder({ linkAccess: "LabMembers", linkPermission: "View" }))).toBe(true);
  });
});

describe("canManageFileSharing", () => {
  it("the owner of a My Drive file", async () => {
    expect(await canManageFileSharing("owner", myDrive())).toBe(true);
  });

  it("a stranger", async () => {
    expect(await canManageFileSharing("stranger", myDrive())).toBe(false);
  });

  it("someone who can edit the file through its folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(full);
    expect(await canManageFileSharing("editor", inFolder())).toBe(true);
  });

  it("a folder viewer cannot manage", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(viewOnly);
    expect(await canManageFileSharing("viewer", inFolder())).toBe(false);
  });

  it("a project member can manage a loose project file; a lab member cannot", async () => {
    const file = { id: "f1", projectId: "p1", workspaceType: null, workspaceId: null, folderPageId: null };
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canManageFileSharing("labber", file)).toBe(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    expect(await canManageFileSharing("member", file)).toBe(true);
  });

  it("FullAccess on the file lets someone re-share it", async () => {
    vi.mocked(sharePermissionForFile).mockResolvedValue("FullAccess");
    expect(await canManageFileSharing("sharee", inFolder())).toBe(true);
  });

  it.each(["View", "Comment", "Edit"] as const)("a %s share does not let someone manage sharing", async (level) => {
    vi.mocked(sharePermissionForFile).mockResolvedValue(level);
    expect(await canManageFileSharing("sharee", inFolder())).toBe(false);
  });

  it("link access never lets anyone manage sharing", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canManageFileSharing("labber", inFolder({ linkAccess: "LabMembers", linkPermission: "Edit" }))).toBe(
      false,
    );
  });
});

describe("filterViewableFiles", () => {
  it("checks a folder once per place and keeps a file shared by name out of a hidden folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(denied);
    vi.mocked(sharePermissionForFile).mockImplementation(async (id) => (id === "shared" ? "View" : null));
    const files = [
      inFolder({ id: "plain-1" }),
      inFolder({ id: "plain-2" }),
      inFolder({ id: "shared" }),
      inFolder({ id: "other", folderPageId: "other-folder" }),
    ];

    const viewable = await filterViewableFiles("u", files);

    expect(viewable.map((f) => f.id)).toEqual(["shared"]);
    expect(getPageAccess).toHaveBeenCalledTimes(2);
  });

  it("does not share an access answer across owners of My Drive files", async () => {
    const files = [myDrive({ id: "mine", workspaceId: "u1" }), myDrive({ id: "theirs", workspaceId: "u2" })];
    expect((await filterViewableFiles("u1", files)).map((f) => f.id)).toEqual(["mine"]);
  });
});
