import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { page: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() } },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({
  addPageShare: vi.fn(),
  listPageShares: vi.fn(),
  removePageShare: vi.fn(),
  SharePrincipalError: class extends Error {},
}));
vi.mock("~/members/lib/personal-notes.server", () => ({
  NoteForbiddenError: class extends Error {},
  NoteNotFoundError: class extends Error {},
  requireNoteOwner: vi.fn(),
}));
vi.mock("~/lib/page-names.server", () => ({ assertUniqueName: vi.fn() }));

import { prisma } from "~/lib/db";
import { assertUniqueName } from "~/lib/page-names.server";
import { createNote, updateNote } from "../personal-notes-actions.server";

const m = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  m.page.findFirst.mockResolvedValue(null);
  m.page.create.mockResolvedValue({ id: "n1" });
  m.page.findUniqueOrThrow.mockResolvedValue({ kind: "FreeForm", title: "Old", parentPageId: "f1" });
});

describe("createNote names", () => {
  it("checks the name among the owner's items in the same place", async () => {
    await createNote("u1", { title: " Ideas ", kind: "Whiteboard" });
    expect(assertUniqueName).toHaveBeenCalledWith({
      workspaceType: "Member",
      workspaceId: "u1",
      parentPageId: null,
      kind: "Whiteboard",
      title: "Ideas",
    });
  });

  it("creates nothing when the name is taken", async () => {
    vi.mocked(assertUniqueName).mockRejectedValue(new Error("taken"));
    await expect(createNote("u1", { title: "Ideas" })).rejects.toThrow("taken");
    expect(m.page.create).not.toHaveBeenCalled();
  });
});

describe("updateNote names", () => {
  it("checks a rename against the folder the note is in, excluding itself", async () => {
    await updateNote("n1", "u1", { title: "New" });
    expect(assertUniqueName).toHaveBeenCalledWith({
      workspaceType: "Member",
      workspaceId: "u1",
      parentPageId: "f1",
      kind: "FreeForm",
      title: "New",
      excludeId: "n1",
    });
  });

  it("checks a move with the title it already has", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Member", workspaceId: "u1", kind: "Folder" });
    await updateNote("n1", "u1", { parentPageId: null });
    expect(assertUniqueName).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: null, title: "Old", excludeId: "n1" }),
    );
  });

  it("updates nothing when the name is taken", async () => {
    vi.mocked(assertUniqueName).mockRejectedValue(new Error("taken"));
    await expect(updateNote("n1", "u1", { title: "New" })).rejects.toThrow("taken");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("does not check an icon change", async () => {
    await updateNote("n1", "u1", { iconEmoji: "x" });
    expect(assertUniqueName).not.toHaveBeenCalled();
  });
});
