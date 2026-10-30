import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

vi.mock("~/lib/meeting-shares.server", () => ({ syncMeetingShares: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { syncMeetingShares } from "~/lib/meeting-shares.server";
import { ensureMeetingNotebook, moveIntoNotebook, trashNotebookIfAbandoned } from "~/lib/pages";

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

    expect(await ensureMeetingNotebook(input)).toEqual({ id: "nb-new", created: true });
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

  it("does not claim to have created a notebook it reused or lost the race for", async () => {
    page.findUnique.mockResolvedValue({ id: "nb-1", archivedAt: null } as never);
    expect(await ensureMeetingNotebook(input)).not.toHaveProperty("created");

    page.findUnique.mockReset();
    page.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "nb-raced" } as never);
    page.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await ensureMeetingNotebook(input)).not.toHaveProperty("created");
  });

  it("creates the notebook with kind Notebook", async () => {
    page.findUnique.mockResolvedValue(null);

    await ensureMeetingNotebook(input);
    expect(page.create.mock.calls[0][0].data.kind).toBe("Notebook");
  });

  it("creates a Lab notebook with kind Notebook too", async () => {
    page.findUnique.mockResolvedValue(null);

    await ensureMeetingNotebook({ ...input, workspaceType: "Lab", workspaceId: null });
    expect(page.create.mock.calls[0][0].data.kind).toBe("Notebook");
  });

  it("starts a fresh notebook when the old one is in the trash", async () => {
    page.findUnique.mockResolvedValue({ id: "nb-old", archivedAt: new Date() } as never);

    expect(await ensureMeetingNotebook(input)).toEqual({ id: "nb-new", created: true });
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
        parent: { kind: "Notebook" },
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
        parent: { kind: "Folder" },
      } as never);

    await moveIntoNotebook("note-1", "nb-team");

    expect(page.update).toHaveBeenCalledTimes(1);
    expect(page.count).not.toHaveBeenCalled();
  });
  it("trashes a manual notebook, which has no auto-grouping key, once it is emptied", async () => {
    page.findUniqueOrThrow
      .mockResolvedValueOnce(notebook as never)
      .mockResolvedValueOnce({
        parentPageId: "nb-manual",
        workspaceType: "Project",
        workspaceId: "p1",
        parent: { kind: "Notebook" },
      } as never);
    page.count.mockResolvedValue(0);

    await moveIntoNotebook("doc-1", "nb-team");

    expect(page.update).toHaveBeenCalledWith({
      where: { id: "nb-manual" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("keeps a notebook that still has tabs", async () => {
    page.findUniqueOrThrow
      .mockResolvedValueOnce(notebook as never)
      .mockResolvedValueOnce({
        parentPageId: "nb-manual",
        workspaceType: "Project",
        workspaceId: "p1",
        parent: { kind: "Notebook" },
      } as never);
    page.count.mockResolvedValue(2);

    await moveIntoNotebook("doc-1", "nb-team");

    expect(page.update).toHaveBeenCalledTimes(1);
  });

  it("files after the tabs already there and leaves the meeting link alone", async () => {
    page.findUniqueOrThrow
      .mockResolvedValueOnce(notebook as never)
      .mockResolvedValueOnce({
        parentPageId: null,
        workspaceType: "Project",
        workspaceId: "p1",
        parent: null,
      } as never);
    page.findFirst.mockResolvedValue({ position: 6 } as never);

    await moveIntoNotebook("note-1", "nb-team");

    const data = page.update.mock.calls[0][0].data;
    expect(data.position).toBe(7);
    expect(data).not.toHaveProperty("meetingNoteId");
    expect(data).not.toHaveProperty("meetingOccurrenceStart");
  });

  it("starts the first tab at position 0", async () => {
    page.findUniqueOrThrow
      .mockResolvedValueOnce(notebook as never)
      .mockResolvedValueOnce({ parentPageId: null, workspaceType: "Project", workspaceId: "p1", parent: null } as never);

    await moveIntoNotebook("note-1", "nb-team");

    expect(page.update.mock.calls[0][0].data.position).toBe(0);
  });

  it("drops the personal-note flags when a My Drive note joins a notebook", async () => {
    page.findUniqueOrThrow
      .mockResolvedValueOnce(notebook as never)
      .mockResolvedValueOnce({ parentPageId: null, workspaceType: "Member", workspaceId: "u1", parent: null } as never);

    await moveIntoNotebook("note-1", "nb-team");

    expect(page.update.mock.calls[0][0].data).toMatchObject({
      profileVisible: false,
      labListing: "None",
      labListingNote: null,
      partnerVisible: false,
    });
  });

  describe("a series notebook and meeting shares", () => {
    const fromNotebook = (over: Record<string, unknown> = {}) => ({
      parentPageId: "nb-series",
      workspaceType: "Project",
      workspaceId: "p1",
      meetingNoteId: null,
      parent: { kind: "Notebook" },
      ...over,
    });

    it("keeps the notebook a series points at when its last tab leaves", async () => {
      page.findUniqueOrThrow.mockResolvedValueOnce(notebook as never).mockResolvedValueOnce(fromNotebook() as never);
      page.count.mockResolvedValue(0);
      vi.mocked(prisma.scheduledMeeting.findFirst).mockResolvedValue({ id: "m1" } as never);

      await moveIntoNotebook("note-1", "nb-team");

      expect(prisma.scheduledMeeting.findFirst).toHaveBeenCalledWith({
        where: { notebookId: "nb-series" },
        select: { id: true },
      });
      expect(page.update).toHaveBeenCalledTimes(1);
    });

    it("trashes an emptied notebook no series points at", async () => {
      page.findUniqueOrThrow.mockResolvedValueOnce(notebook as never).mockResolvedValueOnce(fromNotebook() as never);
      page.count.mockResolvedValue(0);
      vi.mocked(prisma.scheduledMeeting.findFirst).mockResolvedValue(null);

      await moveIntoNotebook("note-1", "nb-team");

      expect(page.update).toHaveBeenCalledWith({ where: { id: "nb-series" }, data: { archivedAt: expect.any(Date) } });
    });

    it("re-syncs the meeting's shares when a meeting note moves", async () => {
      page.findUniqueOrThrow
        .mockResolvedValueOnce(notebook as never)
        .mockResolvedValueOnce(fromNotebook({ meetingNoteId: "m1" }) as never);
      page.count.mockResolvedValue(3);

      await moveIntoNotebook("note-1", "nb-team");

      expect(syncMeetingShares).toHaveBeenCalledWith("m1");
    });

    it("does not sync for a plain doc", async () => {
      page.findUniqueOrThrow.mockResolvedValueOnce(notebook as never).mockResolvedValueOnce(fromNotebook() as never);
      page.count.mockResolvedValue(3);

      await moveIntoNotebook("doc-1", "nb-team");

      expect(syncMeetingShares).not.toHaveBeenCalled();
    });
  });
});

describe("trashNotebookIfAbandoned", () => {
  const findPointer = vi.mocked(prisma.scheduledMeeting.findFirst);

  it("trashes a notebook with no live tabs that no series points at", async () => {
    page.count.mockResolvedValue(0);
    findPointer.mockResolvedValue(null);

    await trashNotebookIfAbandoned("nb-1");

    expect(page.count).toHaveBeenCalledWith({ where: { parentPageId: "nb-1", archivedAt: null } });
    expect(page.update).toHaveBeenCalledWith({ where: { id: "nb-1" }, data: { archivedAt: expect.any(Date) } });
  });

  it("keeps a notebook that still has tabs", async () => {
    page.count.mockResolvedValue(1);
    findPointer.mockResolvedValue(null);

    await trashNotebookIfAbandoned("nb-1");

    expect(page.update).not.toHaveBeenCalled();
  });

  it("keeps an empty notebook a series points at", async () => {
    page.count.mockResolvedValue(0);
    findPointer.mockResolvedValue({ id: "m1" } as never);

    await trashNotebookIfAbandoned("nb-1");

    expect(page.update).not.toHaveBeenCalled();
  });
});
