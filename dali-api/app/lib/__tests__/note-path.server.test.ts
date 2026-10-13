import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { page: { findUnique: vi.fn() }, project: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/drive-reveal.server", () => ({ driveLocation: vi.fn() }));

import { prisma } from "~/lib/db";
import { driveLocation } from "~/lib/drive-reveal.server";
import { formatFiledPath, meetingNotePath } from "~/lib/note-path.server";

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
