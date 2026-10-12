import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/bindings.server", () => ({
  ensureProcessFolder: vi.fn(),
  CORE_PROCESS_ID: "core",
  LAB_PROCESS_ID: "lab",
}));

import { prisma } from "~/lib/db";
import { ensureMeetingNotebook, moveIntoNotebook } from "~/lib/pages";

const page = vi.mocked(prisma.page);
const input = {
  key: "project:p1:Team:t-26f",
  title: "Team meeting note 26F",
  createdById: "u1",
  workspaceType: "Project" as const,
  workspaceId: "p1",
  parentPageId: "folder-team",
};

beforeEach(() => {
  vi.resetAllMocks();
  page.findFirst.mockResolvedValue(null);
  page.create.mockResolvedValue({ id: "nb-new" } as never);
});

describe("ensureMeetingNotebook", () => {
  it("reuses the live notebook for a key without creating another", async () => {
    page.findUnique.mockResolvedValue({ id: "nb-1", archivedAt: null } as never);

    expect(await ensureMeetingNotebook(input)).toEqual({ id: "nb-1" });
    expect(page.create).not.toHaveBeenCalled();
  });

  it("creates the notebook in the given folder when the key is new", async () => {
    page.findUnique.mockResolvedValue(null);

    expect(await ensureMeetingNotebook(input)).toEqual({ id: "nb-new" });
    expect(page.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceType: "Project",
          workspaceId: "p1",
          parentPageId: "folder-team",
          title: "Team meeting note 26F",
          notebookKey: input.key,
        }),
      }),
    );
  });

  it("starts a fresh notebook when the old one is in the trash", async () => {
    page.findUnique.mockResolvedValue({ id: "nb-old", archivedAt: new Date() } as never);

    expect(await ensureMeetingNotebook(input)).toEqual({ id: "nb-new" });
    // The trashed one gives up the key but stays a notebook for its own tabs.
    expect(page.update).toHaveBeenCalledWith({
      where: { id: "nb-old" },
      data: { notebookKey: `${input.key}#nb-old` },
    });
  });

  it("files into the notebook a concurrent create won the key for", async () => {
    page.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "nb-raced" } as never);
    page.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    expect(await ensureMeetingNotebook(input)).toEqual({ id: "nb-raced" });
  });
});

describe("moveIntoNotebook", () => {
  const notebook = { workspaceType: "Project", workspaceId: "p1", linkAccess: "Restricted", linkPermission: "View" };

  it("takes on the notebook's workspace and access, and trashes a notebook it emptied", async () => {
    page.findUniqueOrThrow
      .mockResolvedValueOnce(notebook as never)
      .mockResolvedValueOnce({
        parentPageId: "nb-general",
        workspaceType: "Lab",
        workspaceId: null,
        parent: { notebookKey: "general:users:abc" },
      } as never);
    page.count.mockResolvedValue(0);

    await moveIntoNotebook("note-1", "nb-team");

    expect(page.update).toHaveBeenCalledWith({
      where: { id: "note-1" },
      data: expect.objectContaining({ ...notebook, parentPageId: "nb-team", partnerVisible: false }),
    });
    expect(page.update).toHaveBeenCalledWith({
      where: { id: "nb-general" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("leaves the folder a loose note came from alone", async () => {
    page.findUniqueOrThrow
      .mockResolvedValueOnce(notebook as never)
      .mockResolvedValueOnce({
        parentPageId: "folder-team",
        workspaceType: "Project",
        workspaceId: "p1",
        parent: { notebookKey: null },
      } as never);

    await moveIntoNotebook("note-1", "nb-team");

    expect(page.update).toHaveBeenCalledTimes(1);
    expect(page.count).not.toHaveBeenCalled();
  });
});
