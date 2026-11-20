import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getPageAccess: vi.fn(),
  canEditProject: vi.fn(),
  findNameConflict: vi.fn(),
  loadManageableNotebook: vi.fn(),
}));

vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: m.getPageAccess }));
vi.mock("~/lib/project-access", () => ({ canEditProject: m.canEditProject }));
vi.mock("~/drive/lib/page-names.server", () => ({ findNameConflict: m.findNameConflict }));
vi.mock("~/drive/lib/notebook-access.server", () => ({ loadManageableNotebook: m.loadManageableNotebook }));

import { HttpError } from "~/lib/http-error";
import { errorResponse } from "~/lib/http-error.server";
import {
  canEditPageMetadata,
  isRenamableWorkspace,
  PageRenameError,
  resolveRenameTitle,
  type RenamablePage,
} from "../page-rename.server";

const page = (o: Partial<RenamablePage> = {}): RenamablePage => ({
  id: "p1",
  workspaceType: "Lab",
  workspaceId: null,
  parentPageId: "parent",
  kind: "Page",
  ...o,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.findNameConflict.mockResolvedValue(null);
});

describe("isRenamableWorkspace", () => {
  it.each([
    ["Lab", null, true],
    ["Project", "pr1", true],
    ["EducationOffering", "o1", true],
    ["Member", "u1", true],
    ["Project", null, false],
    ["Member", null, false],
    ["Personal", "u1", false],
  ])("%s with workspace %s is %s", (workspaceType, workspaceId, expected) => {
    expect(isRenamableWorkspace({ workspaceType, workspaceId } as never)).toBe(expected);
  });
});

describe("canEditPageMetadata", () => {
  it("refuses a workspace that can't be renamed without checking access", async () => {
    expect(await canEditPageMetadata("u1", { id: "p1", workspaceType: "Project", workspaceId: null })).toBe(false);
    expect(m.getPageAccess).not.toHaveBeenCalled();
  });

  it("defers to project edit rights for project pages", async () => {
    m.canEditProject.mockResolvedValue(true);
    expect(await canEditPageMetadata("u1", { id: "p1", workspaceType: "Project", workspaceId: "pr1" })).toBe(true);
    expect(m.canEditProject).toHaveBeenCalledWith("u1", "pr1", undefined);
  });

  it("lets members rename pages in their own workspace", async () => {
    expect(await canEditPageMetadata("u1", { id: "p1", workspaceType: "Member", workspaceId: "u1" })).toBe(true);
    expect(m.getPageAccess).not.toHaveBeenCalled();
  });

  it("uses page access for everything else", async () => {
    m.getPageAccess.mockResolvedValue({ canEdit: false });
    expect(await canEditPageMetadata("u1", { id: "p1", workspaceType: "Member", workspaceId: "u2" })).toBe(false);
    m.getPageAccess.mockResolvedValue({ canEdit: true });
    expect(await canEditPageMetadata("u1", { id: "p1", workspaceType: "Lab", workspaceId: null })).toBe(true);
  });
});

describe("resolveRenameTitle", () => {
  it("returns the trimmed title and checks siblings excluding the page itself", async () => {
    expect(await resolveRenameTitle(page(), "  New name  ", "u1")).toBe("New name");
    expect(m.findNameConflict).toHaveBeenCalledWith({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "parent",
      kind: "Page",
      title: "New name",
      excludeId: "p1",
    });
    expect(m.loadManageableNotebook).not.toHaveBeenCalled();
  });

  it("rejects a blank title with a 400 before looking for conflicts", async () => {
    const err = await resolveRenameTitle(page(), "   ", "u1").catch((e) => e);
    expect(err).toBeInstanceOf(PageRenameError);
    expect(err).toMatchObject({ status: 400, message: "Title is required" });
    expect(m.findNameConflict).not.toHaveBeenCalled();
  });

  it("rejects a name that is already taken with a 409 carrying the conflict message", async () => {
    m.findNameConflict.mockResolvedValue("A page named Notes already exists here");
    const err = await resolveRenameTitle(page(), "Notes", "u1").catch((e) => e);
    expect(err).toMatchObject({ status: 409, message: "A page named Notes already exists here" });
  });

  it("requires notebook management rights when renaming a notebook", async () => {
    m.loadManageableNotebook.mockRejectedValue(new Error("nope"));
    await expect(resolveRenameTitle(page({ kind: "Notebook" }), "Book", "u1", undefined)).rejects.toThrow("nope");
    expect(m.loadManageableNotebook).toHaveBeenCalledWith("p1", "u1", undefined);
  });
});

describe("PageRenameError", () => {
  it("is an HttpError the shared responder turns into its status and message", async () => {
    const err = new PageRenameError("Title is required", 400);
    expect(err).toBeInstanceOf(HttpError);
    const res = errorResponse(err);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });
});
