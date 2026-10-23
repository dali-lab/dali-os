import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { page: { findUnique: vi.fn() }, project: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/drive-reveal.server", () => ({ driveLocation: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));

import { prisma } from "~/lib/db";
import { driveLocation } from "~/lib/drive-reveal.server";
import { formatFiledPath, meetingNotePath, notebookItemLocation, pageItemLocation } from "~/lib/note-path.server";
import { getPageAccess } from "~/lib/pageAccess.server";

const m = prisma as any;
const crumb = (title: string) => ({ id: title, title, iconEmoji: null });

const notebook = (over: Record<string, unknown> = {}) => ({
  title: "Weekly sync notes",
  parentPageId: "f1",
  workspaceType: "Lab",
  workspaceId: null,
  ...over,
});

const run = () =>
  meetingNotePath({ notePageId: "note-1", notebookId: "nb-1", viewerSub: "u1" });

beforeEach(() => {
  vi.resetAllMocks();
  m.page.findUnique.mockResolvedValue(notebook());
});

describe("formatFiledPath", () => {
  it("joins the parts with a right-pointing triangle", () => {
    expect(formatFiledPath(["Core", "Weekly sync"])).toBe("Core ▸ Weekly sync");
  });
});

describe("meetingNotePath", () => {
  it("names the space, folders and notebook, and links to the note", async () => {
    vi.mocked(driveLocation).mockResolvedValue({
      scope: "lab",
      folders: [crumb("Meeting assets")],
      workspaceFolderId: null,
    });
    expect(await run()).toEqual({
      label: "General ▸ Meeting assets ▸ Weekly sync notes",
      href: "/documents/note-1",
    });
  });

  it("uses the registry's label for a process space", async () => {
    vi.mocked(driveLocation).mockResolvedValue({ scope: "core", folders: [], workspaceFolderId: null });
    expect((await run())?.label).toBe("Core ▸ Weekly sync notes");
  });

  it("puts the project's name between Projects and its folders", async () => {
    m.page.findUnique.mockResolvedValue(notebook({ workspaceType: "Project", workspaceId: "p1" }));
    m.project.findUnique.mockResolvedValue({ name: "Cortex" });
    vi.mocked(driveLocation).mockResolvedValue({
      scope: "projects",
      folders: [crumb("Team meeting notes")],
      workspaceFolderId: "p1",
    });
    expect((await run())?.label).toBe("Projects ▸ Cortex ▸ Team meeting notes ▸ Weekly sync notes");
  });

  it("asks for the location from the notebook's folder", async () => {
    vi.mocked(driveLocation).mockResolvedValue({ scope: "lab", folders: [], workspaceFolderId: null });
    await run();
    expect(driveLocation).toHaveBeenCalledWith("f1", expect.objectContaining({ workspaceType: "Lab" }), "u1", undefined);
  });

  it("is null without a notebook, or when the notebook is gone", async () => {
    expect(await meetingNotePath({ notePageId: "n", notebookId: null, viewerSub: "u1" })).toBeNull();
    m.page.findUnique.mockResolvedValue(null);
    expect(await run()).toBeNull();
  });
});

describe("notebookItemLocation", () => {
  const place = { parentPageId: "f1", workspaceType: "Project", workspaceId: "p1" };

  it("carries the ids the Drive opens: the project, then each folder, ending at the nearest", async () => {
    m.project.findUnique.mockResolvedValue({ name: "Project Alpha" });
    vi.mocked(driveLocation).mockResolvedValue({
      scope: "projects",
      folders: [crumb("Meetings")],
      workspaceFolderId: "p1",
    });

    expect(await notebookItemLocation(place, "u1")).toEqual({
      scopeId: "projects",
      scopeLabel: "Projects",
      folderId: "Meetings",
      folders: [
        { id: "p1", title: "Project Alpha", synthetic: true },
        { id: "Meetings", title: "Meetings" },
      ],
      path: "Projects ▸ Project Alpha ▸ Meetings",
    });
  });

  it("carries the project emoji and each folder's type for the crumb glyphs", async () => {
    m.project.findUnique.mockResolvedValue({ name: "Project Alpha", iconEmoji: "🚀" });
    vi.mocked(driveLocation).mockResolvedValue({
      scope: "projects",
      folders: [{ ...crumb("Meetings"), folderType: "Meetings" }],
      workspaceFolderId: "p1",
    });

    expect((await notebookItemLocation(place, "u1")).folders).toEqual([
      { id: "p1", title: "Project Alpha", iconEmoji: "🚀", synthetic: true },
      { id: "Meetings", title: "Meetings", folderType: "Meetings" },
    ]);
  });

  it("opens the project when the notebook sits at its top", async () => {
    m.project.findUnique.mockResolvedValue({ name: "Project Alpha" });
    vi.mocked(driveLocation).mockResolvedValue({ scope: "projects", folders: [], workspaceFolderId: "p1" });

    expect(await notebookItemLocation(place, "u1")).toMatchObject({ folderId: "p1", path: "Projects ▸ Project Alpha" });
  });

  it("has no folder for a notebook at the top of its space", async () => {
    vi.mocked(driveLocation).mockResolvedValue({ scope: "core", folders: [], workspaceFolderId: null });

    expect(await notebookItemLocation({ parentPageId: null, workspaceType: "Lab", workspaceId: null }, "u1")).toEqual({
      scopeId: "core",
      scopeLabel: "Core",
      folderId: null,
      folders: [],
      path: "Core",
    });
  });
});

describe("pageItemLocation", () => {
  const doc = { id: "d1", title: "test", parentPageId: "f1", workspaceType: "Lab", workspaceId: null } as any;

  it("places a page in its own space and folders", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true } as any);
    vi.mocked(driveLocation).mockResolvedValue({ scope: "lab", folders: [crumb("Design")], workspaceFolderId: null } as any);

    const where = await pageItemLocation(doc, "u1");

    expect(getPageAccess).toHaveBeenCalledWith("u1", doc, undefined, { ignoreShares: true });
    expect(where.scopeId).toBe("lab");
    expect(where.folders.map((f) => f.title)).toEqual(["Design"]);
    expect(driveLocation).toHaveBeenCalledWith("f1", doc, "u1", undefined);
  });

  it("puts a page reached only through a share in Shared with me", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: false } as any);

    expect(await pageItemLocation(doc, "u1")).toEqual({
      scopeId: "shared",
      scopeLabel: "Shared with me",
      folderId: null,
      folders: [],
      path: "Shared with me",
    });
    expect(driveLocation).not.toHaveBeenCalled();
  });
});
