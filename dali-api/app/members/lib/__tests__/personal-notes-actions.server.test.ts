import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    collabDocument: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({
  addPageShare: vi.fn(),
  listPageShares: vi.fn(),
  removePageShare: vi.fn(),
  SharePrincipalError: class SharePrincipalError extends Error {},
}));
vi.mock("~/members/lib/personal-notes.server", () => {
  class NoteNotFoundError extends Error {}
  class NoteForbiddenError extends Error {}
  return { NoteNotFoundError, NoteForbiddenError, requireNoteOwner: vi.fn() };
});
vi.mock("~/drive/lib/page-names.server", () => ({ assertUniqueName: vi.fn() }));
vi.mock("~/lib/pages", () => ({
  pageDepth: vi.fn(),
  isAncestorOf: vi.fn(),
  MAX_PAGE_DEPTH: 4,
}));
vi.mock("~/collab/roomName", () => ({ pageDocName: (id: string) => `page:${id}` }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { addPageShare, listPageShares, removePageShare, SharePrincipalError } from "~/lib/page-sharing.server";
import { NoteForbiddenError, NoteNotFoundError, requireNoteOwner } from "~/members/lib/personal-notes.server";
import { assertUniqueName } from "~/drive/lib/page-names.server";
import { pageDepth, isAncestorOf } from "~/lib/pages";
import {
  addNoteShare,
  archiveNote,
  createNote,
  deleteNote,
  listNoteShares,
  proposeLabListing,
  removeNoteShare,
  reviewLabListing,
  setNoteVisibility,
  updateNote,
  withdrawLabListing,
} from "../personal-notes-actions.server";

const m = prisma as any;
const OWNER = "owner-1";
const INTRUDER = "intruder-1";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireNoteOwner).mockResolvedValue(undefined as never);
  m.page.findFirst.mockResolvedValue(null);
  m.page.create.mockResolvedValue({ id: "new" });
  m.page.count.mockResolvedValue(0);
  m.page.findUniqueOrThrow.mockResolvedValue({ kind: "FreeForm", title: "Old", parentPageId: null });
  vi.mocked(pageDepth).mockResolvedValue(0);
  vi.mocked(isAncestorOf).mockResolvedValue(false);
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m));
});

describe("ownership: every owner-only write refuses a non-owner and writes nothing", () => {
  const writes: Array<[string, () => Promise<unknown>]> = [
    ["updateNote", () => updateNote("n1", INTRUDER, { title: "Mine now" })],
    ["setNoteVisibility", () => setNoteVisibility("n1", INTRUDER, true)],
    ["addNoteShare", () => addNoteShare("n1", INTRUDER, "User", "friend")],
    ["removeNoteShare", () => removeNoteShare("n1", INTRUDER, "s1")],
    ["listNoteShares", () => listNoteShares("n1", INTRUDER)],
    ["proposeLabListing", () => proposeLabListing("n1", INTRUDER, null)],
    ["withdrawLabListing", () => withdrawLabListing("n1", INTRUDER)],
    ["archiveNote", () => archiveNote("n1", INTRUDER)],
    ["deleteNote", () => deleteNote("n1", INTRUDER)],
  ];

  it.each(writes)("%s", async (_name, call) => {
    vi.mocked(requireNoteOwner).mockRejectedValue(new NoteNotFoundError());
    await expect(call()).rejects.toBeInstanceOf(NoteNotFoundError);
    expect(requireNoteOwner).toHaveBeenCalledWith("n1", INTRUDER);
    expect(m.page.update).not.toHaveBeenCalled();
    expect(m.page.delete).not.toHaveBeenCalled();
    expect(m.collabDocument.deleteMany).not.toHaveBeenCalled();
    expect(addPageShare).not.toHaveBeenCalled();
    expect(removePageShare).not.toHaveBeenCalled();
    expect(listPageShares).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("createNote", () => {
  it("creates in the owner's Member workspace, authored by the owner", async () => {
    await createNote(OWNER, { title: "Ideas" });
    expect(m.page.create.mock.calls[0][0].data).toEqual({
      workspaceType: "Member",
      workspaceId: OWNER,
      parentPageId: null,
      title: "Ideas",
      kind: "FreeForm",
      position: 0,
      createdById: OWNER,
    });
  });

  it("appends after the last sibling", async () => {
    m.page.findFirst.mockResolvedValue({ position: 4 });
    await createNote(OWNER, { title: "Ideas" });
    expect(m.page.create.mock.calls[0][0].data.position).toBe(5);
  });

  it("defaults titles and kinds for blank, folder and typed notes", async () => {
    await createNote(OWNER, { title: "   " });
    await createNote(OWNER, { isFolder: true });
    await createNote(OWNER, { title: "Board", kind: "Whiteboard" });
    const data = m.page.create.mock.calls.map((c: any) => [c[0].data.title, c[0].data.kind]);
    expect(data).toEqual([
      ["Untitled", "FreeForm"],
      ["Untitled folder", "Folder"],
      ["Board", "Whiteboard"],
    ]);
  });

  it("refuses a parent that belongs to someone else as if it did not exist", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", workspaceId: INTRUDER, kind: "Folder" });
    await expect(createNote(OWNER, { parentPageId: "f1" })).rejects.toBeInstanceOf(NoteNotFoundError);
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it("refuses a parent in a non-Member workspace or that is missing", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Project", workspaceId: OWNER, kind: "Folder" });
    await expect(createNote(OWNER, { parentPageId: "f1" })).rejects.toBeInstanceOf(NoteNotFoundError);
    m.page.findUnique.mockResolvedValue(null);
    await expect(createNote(OWNER, { parentPageId: "f1" })).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("refuses to nest inside a note that isn't a folder", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", workspaceId: OWNER, kind: "FreeForm" });
    await expect(createNote(OWNER, { parentPageId: "f1" })).rejects.toThrow("Notes can only nest inside a folder");
  });

  it("refuses a folder that is already at the maximum depth", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", workspaceId: OWNER, kind: "Folder" });
    vi.mocked(pageDepth).mockResolvedValue(4);
    await expect(createNote(OWNER, { parentPageId: "f1" })).rejects.toThrow("too deeply nested");
    vi.mocked(pageDepth).mockResolvedValue(-1);
    await expect(createNote(OWNER, { parentPageId: "f1" })).rejects.toThrow("too deeply nested");
  });

  it("nests under an owned folder with room", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", workspaceId: OWNER, kind: "Folder" });
    vi.mocked(pageDepth).mockResolvedValue(3);
    await createNote(OWNER, { title: "Deep", parentPageId: "f1" });
    expect(m.page.create.mock.calls[0][0].data.parentPageId).toBe("f1");
  });
});

describe("updateNote", () => {
  it("rejects an empty title", async () => {
    await expect(updateNote("n1", OWNER, { title: "  " })).rejects.toThrow("A note needs a title");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("writes trimmed title and stamps lastEditedById", async () => {
    await updateNote("n1", OWNER, { title: " New " });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { title: "New", lastEditedById: OWNER },
    });
  });

  it("clears an empty icon to null and skips the name check for icon-only edits", async () => {
    await updateNote("n1", OWNER, { iconEmoji: "" });
    expect(m.page.update.mock.calls[0][0].data).toEqual({ iconEmoji: null, lastEditedById: OWNER });
    expect(assertUniqueName).not.toHaveBeenCalled();
  });

  it("does nothing when no field is given", async () => {
    await updateNote("n1", OWNER, {});
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("refuses to move a note into itself", async () => {
    await expect(updateNote("n1", OWNER, { parentPageId: "n1" })).rejects.toThrow("into itself");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("refuses to move a folder into its own subtree", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", workspaceId: OWNER, kind: "Folder" });
    vi.mocked(isAncestorOf).mockResolvedValue(true);
    await expect(updateNote("n1", OWNER, { parentPageId: "child" })).rejects.toThrow("own contents");
    expect(isAncestorOf).toHaveBeenCalledWith("n1", "child");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("refuses to move into a folder someone else owns", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", workspaceId: INTRUDER, kind: "Folder" });
    await expect(updateNote("n1", OWNER, { parentPageId: "theirs" })).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("moves to the top level when parentPageId is empty", async () => {
    m.page.findUniqueOrThrow.mockResolvedValue({ kind: "FreeForm", title: "Old", parentPageId: "f1" });
    await updateNote("n1", OWNER, { parentPageId: "" });
    expect(m.page.update.mock.calls[0][0].data.parentPageId).toBeNull();
  });
});

describe("setNoteVisibility", () => {
  it("flips profileVisible and audits it, without touching shares", async () => {
    await setNoteVisibility("n1", OWNER, true);
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "n1" }, data: { profileVisible: true } });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "note.visibility",
      userId: OWNER,
      targetId: "n1",
      metadata: { profileVisible: true },
    });
    expect(removePageShare).not.toHaveBeenCalled();
  });
});

describe("addNoteShare", () => {
  it("refuses to share a note with its owner", async () => {
    await expect(addNoteShare("n1", OWNER, "User", OWNER)).rejects.toThrow("already have access");
    expect(addPageShare).not.toHaveBeenCalled();
  });

  it("lets the owner share it with a group whose id equals their user id", async () => {
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, alreadyShared: false } as never);
    await addNoteShare("n1", OWNER, "Group", OWNER);
    expect(addPageShare).toHaveBeenCalledWith("n1", OWNER, "Group", OWNER);
  });

  it("returns the share result", async () => {
    vi.mocked(addPageShare).mockResolvedValue({ ok: true, alreadyShared: true } as never);
    expect(await addNoteShare("n1", OWNER, "User", "friend")).toEqual({ ok: true, alreadyShared: true });
  });

  it("maps a vanished principal to not-found and an archived group to forbidden", async () => {
    vi.mocked(addPageShare).mockRejectedValueOnce(new SharePrincipalError("That person no longer exists"));
    await expect(addNoteShare("n1", OWNER, "User", "gone")).rejects.toBeInstanceOf(NoteNotFoundError);
    vi.mocked(addPageShare).mockRejectedValueOnce(new SharePrincipalError("That group is archived"));
    await expect(addNoteShare("n1", OWNER, "Group", "g")).rejects.toBeInstanceOf(NoteForbiddenError);
  });

  it("rethrows unexpected errors", async () => {
    vi.mocked(addPageShare).mockRejectedValue(new Error("db down"));
    await expect(addNoteShare("n1", OWNER, "User", "friend")).rejects.toThrow("db down");
  });
});

describe("share list / removal", () => {
  it("removes a share by id for the owner", async () => {
    await removeNoteShare("n1", OWNER, "s1");
    expect(removePageShare).toHaveBeenCalledWith("n1", "s1");
  });

  it("lists shares for the owner", async () => {
    vi.mocked(listPageShares).mockResolvedValue([{ id: "s1" }] as never);
    expect(await listNoteShares("n1", OWNER)).toEqual([{ id: "s1" }]);
  });
});

describe("proposeLabListing", () => {
  const page = (o: Record<string, unknown> = {}) => ({
    profileVisible: true,
    labListing: "None",
    kind: "FreeForm",
    ...o,
  });

  it("is not-found when the page is gone", async () => {
    m.page.findUnique.mockResolvedValue(null);
    await expect(proposeLabListing("n1", OWNER, null)).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("refuses folders and private notes (listing can't widen the audience by proxy)", async () => {
    m.page.findUnique.mockResolvedValue(page({ kind: "Folder" }));
    await expect(proposeLabListing("n1", OWNER, null)).rejects.toThrow("Folders can't be listed");
    m.page.findUnique.mockResolvedValue(page({ profileVisible: false }));
    await expect(proposeLabListing("n1", OWNER, null)).rejects.toThrow("Make the note public");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("is a no-op for an already-listed note", async () => {
    m.page.findUnique.mockResolvedValue(page({ labListing: "Listed" }));
    await proposeLabListing("n1", OWNER, "hi");
    expect(m.page.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("marks it Proposed with the trimmed note, resets any prior review, and audits", async () => {
    m.page.findUnique.mockResolvedValue(page({ labListing: "Declined" }));
    await proposeLabListing("n1", OWNER, "  useful guide ");
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: {
        labListing: "Proposed",
        labListingNote: "useful guide",
        labListingReviewedById: null,
        labListingReviewedAt: null,
      },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "note.lab-listing.propose", userId: OWNER, targetId: "n1" }),
    );
  });

  it("stores a blank note as null", async () => {
    m.page.findUnique.mockResolvedValue(page());
    await proposeLabListing("n1", OWNER, "   ");
    expect(m.page.update.mock.calls[0][0].data.labListingNote).toBeNull();
  });
});

describe("withdrawLabListing", () => {
  it("resets the listing and its note", async () => {
    await withdrawLabListing("n1", OWNER);
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { labListing: "None", labListingNote: null },
    });
  });
});

describe("reviewLabListing", () => {
  it("is not-found for a missing page or one outside a member workspace", async () => {
    m.page.findUnique.mockResolvedValue(null);
    await expect(reviewLabListing("n1", "core-1", "Listed")).rejects.toBeInstanceOf(NoteNotFoundError);
    m.page.findUnique.mockResolvedValue({ workspaceType: "Project", labListing: "Proposed", profileVisible: true });
    await expect(reviewLabListing("n1", "core-1", "Listed")).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("only decides notes that are awaiting review", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", labListing: "None", profileVisible: true });
    await expect(reviewLabListing("n1", "core-1", "Listed")).rejects.toThrow("isn't awaiting review");
  });

  it("won't list a note the owner has since made private, but can still decline it", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", labListing: "Proposed", profileVisible: false });
    await expect(reviewLabListing("n1", "core-1", "Listed")).rejects.toThrow("no longer public");
    expect(m.page.update).not.toHaveBeenCalled();
    await reviewLabListing("n1", "core-1", "Declined");
    expect(m.page.update.mock.calls[0][0].data.labListing).toBe("Declined");
  });

  it("records the decision, reviewer and time, and audits it (without needing ownership)", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", labListing: "Proposed", profileVisible: true });
    await reviewLabListing("n1", "core-1", "Listed");
    expect(requireNoteOwner).not.toHaveBeenCalled();
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { labListing: "Listed", labListingReviewedById: "core-1", labListingReviewedAt: expect.any(Date) },
    });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "note.lab-listing.review",
      userId: "core-1",
      targetId: "n1",
      metadata: { decision: "Listed" },
    });
  });
});

describe("archiveNote", () => {
  it("refuses a folder that still has children", async () => {
    m.page.count.mockResolvedValue(2);
    await expect(archiveNote("n1", OWNER)).rejects.toThrow("still holds 2 note(s)");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("archives and pulls the note off the profile and the lab shelf", async () => {
    await archiveNote("n1", OWNER);
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { archivedAt: expect.any(Date), profileVisible: false, labListing: "None" },
    });
  });
});

describe("deleteNote", () => {
  it("refuses a folder that still has children", async () => {
    m.page.count.mockResolvedValue(1);
    await expect(deleteNote("n1", OWNER)).rejects.toThrow("move or delete them first");
    expect(m.page.delete).not.toHaveBeenCalled();
  });

  it("deletes the collab body and the page together, then audits", async () => {
    await deleteNote("n1", OWNER);
    expect(m.collabDocument.deleteMany).toHaveBeenCalledWith({ where: { name: "page:n1" } });
    expect(m.page.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "note.delete",
      userId: OWNER,
      targetId: "n1",
      metadata: {},
    });
  });
});
