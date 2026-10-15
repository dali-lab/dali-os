import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    term: { findUnique: vi.fn() },
    groupDefinition: { findUnique: vi.fn() },
    pageShare: { upsert: vi.fn() },
    collabDocument: { findUnique: vi.fn(), updateMany: vi.fn() },
    collabDocumentVersion: { updateMany: vi.fn() },
    mentorNote: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/pages", () => ({ ensureMeetingNotebook: vi.fn(), createNotebookTab: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({
  resolveFilingFolder: vi.fn(),
  singletonSlot: vi.fn((processType: string, folderType: string) => ({ processType, folderType })),
}));
vi.mock("~/collab/write", () => ({ replaceCollabDocContent: vi.fn() }));

import { prisma } from "~/lib/db";
import { createNotebookTab, ensureMeetingNotebook } from "~/lib/pages";
import { resolveFilingFolder } from "~/lib/drive-receivers.server";
import { replaceCollabDocContent } from "~/collab/write";
import {
  archiveMentorNotePage,
  ensureMentorNotePage,
  ensurePairNotebook,
  pairNotebookKey,
  pairNotebookTitle,
  weekTabTitle,
  type MentorNoteRef,
} from "../pair-notebook.server";

const m = prisma as any;

const PAIR = { mentorId: "u_mentor", menteeId: "u_mentee", projectId: "p1", termId: "t1", domainId: "d1" };
const NOTE: MentorNoteRef = {
  id: "n1",
  ...PAIR,
  weekOf: new Date("2026-10-12T00:00:00Z"),
  pageId: null,
  contentJson: {},
};
const BLOCKS = [{ type: "paragraph", content: "hello" }];

beforeEach(() => {
  vi.resetAllMocks();
  m.page.findUnique.mockResolvedValue(null);
  m.user.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === PAIR.mentorId ? { firstName: "Mia", lastName: "Mentor" } : { firstName: "Eli", lastName: "Mentee" },
  );
  m.term.findUnique.mockResolvedValue({ code: "26F" });
  m.groupDefinition.findUnique.mockResolvedValue({ id: "g_core" });
  vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "root_m", viaReceiver: false });
  vi.mocked(ensureMeetingNotebook).mockResolvedValue({ id: "nb1" });
  vi.mocked(createNotebookTab).mockResolvedValue({ id: "tab1" });
  m.pageShare.upsert.mockResolvedValue({});
  m.collabDocument.findUnique.mockResolvedValue(null);
  m.collabDocument.updateMany.mockResolvedValue({ count: 0 });
  m.collabDocumentVersion.updateMany.mockResolvedValue({ count: 0 });
  m.mentorNote.updateMany.mockResolvedValue({ count: 1 });
  m.page.delete.mockResolvedValue({});
  m.$transaction.mockImplementation(async (fn: any) => fn(prisma));
});

describe("pair notebook naming", () => {
  it("keys a notebook by the full mentor, mentee, project, term, domain tuple", () => {
    expect(pairNotebookKey(PAIR)).toBe("mentorship:u_mentor:u_mentee:p1:t1:d1");
  });

  it("titles it with the mentee, mentor and term", () => {
    expect(pairNotebookTitle("Eli Mentee", "Mia Mentor", "26F")).toBe("Eli Mentee with Mia Mentor (26F)");
  });

  it("titles a week tab by its Monday in UTC", () => {
    expect(weekTabTitle(new Date("2026-10-12T00:00:00Z"))).toBe("Week of Oct 12, 2026");
  });
});

describe("ensurePairNotebook", () => {
  it("returns a live notebook for the key without creating or re-sharing", async () => {
    m.page.findUnique.mockResolvedValue({ id: "nb_old", archivedAt: null });

    expect(await ensurePairNotebook({ ...PAIR, actorId: "u_core" })).toEqual({ id: "nb_old" });

    expect(ensureMeetingNotebook).not.toHaveBeenCalled();
    expect(m.pageShare.upsert).not.toHaveBeenCalled();
  });

  it("creates a restricted Lab notebook under the mentor-notebooks folder, keyed and titled by the pair", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "f_26f", viaReceiver: true });

    await ensurePairNotebook({ ...PAIR, actorId: "u_core" });

    expect(resolveFilingFolder).toHaveBeenCalledWith(
      { processType: "Mentorship", folderType: "MentorNotebooks" },
      "u_core",
    );
    expect(ensureMeetingNotebook).toHaveBeenCalledWith({
      key: "mentorship:u_mentor:u_mentee:p1:t1:d1",
      title: "Eli Mentee with Mia Mentor (26F)",
      createdById: "u_core",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "f_26f",
      restricted: true,
    });
  });

  it("files into the Mentorship root when no receiver folder is marked", async () => {
    await ensurePairNotebook({ ...PAIR, actorId: "u_core" });

    expect(vi.mocked(ensureMeetingNotebook).mock.calls[0][0]).toMatchObject({ parentPageId: "root_m" });
  });

  it("starts a fresh notebook when the old one for the key is in the trash", async () => {
    m.page.findUnique.mockResolvedValue({ id: "nb_trashed", archivedAt: new Date() });

    await ensurePairNotebook({ ...PAIR, actorId: "u_core" });

    expect(ensureMeetingNotebook).toHaveBeenCalledTimes(1);
  });

  it("shares Edit with the mentor and the Core group on the notebook", async () => {
    await ensurePairNotebook({ ...PAIR, actorId: "u_core" });

    const created = m.pageShare.upsert.mock.calls.map((c: any[]) => c[0].create);
    expect(created).toEqual(
      expect.arrayContaining([
        { pageId: "nb1", principalType: "User", principalId: "u_mentor", permission: "Edit", createdById: "u_core" },
        { pageId: "nb1", principalType: "Group", principalId: "g_core", permission: "Edit", createdById: "u_core" },
      ]),
    );
    expect(created).toHaveLength(2);
  });

  it("writes shares with an upsert, so two creators racing on the key cannot collide", async () => {
    await ensurePairNotebook({ ...PAIR, actorId: "u_core" });

    for (const [arg] of m.pageShare.upsert.mock.calls) {
      expect(arg.where.pageId_principalType_principalId.pageId).toBe("nb1");
      expect(arg.update).toEqual({});
    }
  });

  it("falls back to placeholder names when a user or term row is gone", async () => {
    m.user.findUnique.mockResolvedValue(null);
    m.term.findUnique.mockResolvedValue(null);

    await ensurePairNotebook({ ...PAIR, actorId: "u_core" });

    expect(vi.mocked(ensureMeetingNotebook).mock.calls[0][0].title).toBe("Unknown mentee with Unknown mentor (?)");
  });

  it("refuses to share when the Core group is missing", async () => {
    m.groupDefinition.findUnique.mockResolvedValue(null);

    await expect(ensurePairNotebook({ ...PAIR, actorId: "u_core" })).rejects.toThrow("Core group is missing");
  });
});

describe("ensureMentorNotePage", () => {
  it("returns the existing page without touching anything", async () => {
    expect(await ensureMentorNotePage({ ...NOTE, pageId: "p_done" }, "u_mentor")).toEqual({ pageId: "p_done" });

    expect(createNotebookTab).not.toHaveBeenCalled();
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("creates a FreeForm week tab in the pair notebook ordered by weekOf", async () => {
    await ensureMentorNotePage(NOTE, "u_mentor");

    expect(createNotebookTab).toHaveBeenCalledWith({
      notebookId: "nb1",
      title: "Week of Oct 12, 2026",
      createdById: "u_mentor",
      meetingOccurrenceStart: NOTE.weekOf,
    });
  });

  it("shares Edit with the author and the Core group on the tab as well as the notebook", async () => {
    await ensureMentorNotePage(NOTE, "u_mentor");

    const tabShares = m.pageShare.upsert.mock.calls
      .map((c: any[]) => c[0].create)
      .filter((c: any) => c.pageId === "tab1");
    expect(tabShares).toEqual(
      expect.arrayContaining([
        { pageId: "tab1", principalType: "User", principalId: "u_mentor", permission: "Edit", createdById: "u_mentor" },
        { pageId: "tab1", principalType: "Group", principalId: "g_core", permission: "Edit", createdById: "u_mentor" },
      ]),
    );
    expect(tabShares).toHaveLength(2);
  });

  it("shares with the note's author, not the actor, when Core migrates someone else's note", async () => {
    await ensureMentorNotePage(NOTE, "u_core");

    const tabUserShare = m.pageShare.upsert.mock.calls
      .map((c: any[]) => c[0].create)
      .find((c: any) => c.pageId === "tab1" && c.principalType === "User");
    expect(tabUserShare.principalId).toBe("u_mentor");
  });

  it("renames an existing room and its versions to the page room in the same transaction that claims the note", async () => {
    m.collabDocument.findUnique.mockResolvedValue({ id: "cd1" });
    m.collabDocument.updateMany.mockResolvedValue({ count: 1 });

    expect(await ensureMentorNotePage({ ...NOTE, contentJson: BLOCKS }, "u_mentor")).toEqual({ pageId: "tab1" });

    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m.mentorNote.updateMany).toHaveBeenCalledWith({ where: { id: "n1", pageId: null }, data: { pageId: "tab1" } });
    expect(m.collabDocument.updateMany).toHaveBeenCalledWith({
      where: { name: "mentorNote:n1:body" },
      data: { name: "doc:tab1:body" },
    });
    expect(m.collabDocumentVersion.updateMany).toHaveBeenCalledWith({
      where: { name: "mentorNote:n1:body" },
      data: { name: "doc:tab1:body" },
    });
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
  });

  it("claims the note before renaming, so a lost race renames nothing", async () => {
    m.collabDocument.findUnique.mockResolvedValue({ id: "cd1" });
    m.mentorNote.updateMany.mockResolvedValue({ count: 0 });
    m.mentorNote.findUniqueOrThrow.mockResolvedValue({ pageId: "tab_winner" });

    expect(await ensureMentorNotePage(NOTE, "u_mentor")).toEqual({ pageId: "tab_winner" });

    expect(m.collabDocument.updateMany).not.toHaveBeenCalled();
    expect(m.collabDocumentVersion.updateMany).not.toHaveBeenCalled();
    expect(m.page.delete).toHaveBeenCalledWith({ where: { id: "tab1" } });
  });

  it("materialises a room from contentJson when the note was never opened in collab", async () => {
    await ensureMentorNotePage({ ...NOTE, contentJson: BLOCKS }, "u_mentor");

    expect(replaceCollabDocContent).toHaveBeenCalledWith("doc:tab1:body", BLOCKS, "u_mentor");
    expect(m.mentorNote.updateMany).toHaveBeenCalledWith({ where: { id: "n1", pageId: null }, data: { pageId: "tab1" } });
  });

  it("maps legacy ProseMirror contentJson to blocks when materialising", async () => {
    const pm = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy" }] }] };

    await ensureMentorNotePage({ ...NOTE, contentJson: pm }, "u_mentor");

    const written = vi.mocked(replaceCollabDocContent).mock.calls[0][1] as any[];
    expect(Array.isArray(written)).toBe(true);
    expect(JSON.stringify(written)).toContain("Legacy");
  });

  it("writes no room for an empty note", async () => {
    await ensureMentorNotePage({ ...NOTE, contentJson: {} }, "u_mentor");

    expect(replaceCollabDocContent).not.toHaveBeenCalled();
  });

  it("deletes the new tab and rethrows when the claim transaction fails", async () => {
    m.$transaction.mockRejectedValue(new Error("db down"));

    await expect(ensureMentorNotePage(NOTE, "u_mentor")).rejects.toThrow("db down");

    expect(m.page.delete).toHaveBeenCalledWith({ where: { id: "tab1" } });
  });
});

describe("archiveMentorNotePage", () => {
  it("trashes the page of a deleted note", async () => {
    await archiveMentorNotePage("tab1");

    expect(m.page.updateMany).toHaveBeenCalledWith({
      where: { id: "tab1", archivedAt: null },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("does nothing for a note that never had a page", async () => {
    await archiveMentorNotePage(null);

    expect(m.page.updateMany).not.toHaveBeenCalled();
  });
});
