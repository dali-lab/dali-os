import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn(), listVisibleGroupsForUser: vi.fn() }));

import { prisma } from "~/lib/db";
import { resolveGroupMembers, listVisibleGroupsForUser } from "~/lib/groups";
import {
  noteAccess,
  requireNoteView,
  requireNoteOwner,
  listSharedWithMe,
  NoteNotFoundError,
  NoteForbiddenError,
} from "~/members/lib/personal-notes.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const OWNER = "owner-1";
const OTHER = "other-1";

// Shaped as listVisibleGroupsForUser returns — groupIdsForUser reads only id + archivedAt.
const memberGroup = (id: string, archivedAt: string | null = null) => ({ id, archivedAt }) as any;

const NOTE = {
  workspaceType: "Member",
  workspaceId: OWNER,
  archivedAt: null,
  profileVisible: false,
  labListing: "None",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.page.findUnique.mockResolvedValue(NOTE);
  mockPrisma.pageShare.findFirst.mockResolvedValue(null);
  mockPrisma.groupDefinition.findMany.mockResolvedValue([]);
  vi.mocked(resolveGroupMembers).mockResolvedValue([]);
  vi.mocked(listVisibleGroupsForUser).mockResolvedValue([]);
});

describe("noteAccess — the owner", () => {
  it("sees and edits their own private note", async () => {
    expect(await noteAccess("pg-1", OWNER)).toEqual({
      canView: true,
      canEdit: true,
      isOwner: true,
    });
  });

  it("can still view but not edit an archived note of their own", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...NOTE, archivedAt: new Date() });
    expect(await noteAccess("pg-1", OWNER)).toMatchObject({ canView: true, canEdit: false });
  });
});

describe("noteAccess — everyone else", () => {
  it("is refused a private, unshared note", async () => {
    expect(await noteAccess("pg-1", OTHER)).toEqual({
      canView: false,
      canEdit: false,
      isOwner: false,
    });
  });

  it("may read a public note, but never edit it", async () => {
    // Sharing is read-only by design: a note is someone's own notebook page.
    mockPrisma.page.findUnique.mockResolvedValue({ ...NOTE, profileVisible: true });
    expect(await noteAccess("pg-1", OTHER)).toEqual({
      canView: true,
      canEdit: false,
      isOwner: false,
    });
  });

  it("may read a lab-listed note", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...NOTE, labListing: "Listed" });
    expect((await noteAccess("pg-1", OTHER)).canView).toBe(true);
  });

  it("may read a PRIVATE note shared with them directly", async () => {
    // The additive rule: sharing grants access without making the note public.
    mockPrisma.pageShare.findFirst.mockResolvedValue({ id: "sh-1" });
    const access = await noteAccess("pg-1", OTHER);
    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(false);
  });

  it("may read a private note shared with a group they belong to", async () => {
    mockPrisma.pageShare.findFirst
      .mockResolvedValueOnce(null) // no direct share
      .mockResolvedValueOnce({ id: "sh-2" }); // matched via group
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([memberGroup("grp-1")]);
    expect((await noteAccess("pg-1", OTHER)).canView).toBe(true);
  });

  it("is refused when shared with a group they are NOT in", async () => {
    // Viewer belongs to no groups, so the group-share query is never attempted.
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([]);
    expect((await noteAccess("pg-1", OTHER)).canView).toBe(false);
    // No group matched, so the group share query is never even attempted.
    expect(mockPrisma.pageShare.findFirst).toHaveBeenCalledTimes(1);
  });

  it("is refused an archived note even when it was public", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      ...NOTE,
      archivedAt: new Date(),
      profileVisible: true,
    });
    expect((await noteAccess("pg-1", OTHER)).canView).toBe(false);
  });
});

describe("noteAccess — not a note at all", () => {
  it("refuses a page from another workspace", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      ...NOTE,
      workspaceType: "Project",
      workspaceId: "proj-1",
    });
    await expect(noteAccess("pg-1", OWNER)).rejects.toThrow(NoteNotFoundError);
  });

  it("refuses a missing page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    await expect(noteAccess("pg-1", OWNER)).rejects.toThrow(NoteNotFoundError);
  });
});

describe("guards", () => {
  it("requireNoteView throws for someone without access", async () => {
    await expect(requireNoteView("pg-1", OTHER)).rejects.toThrow(NoteForbiddenError);
  });

  it("requireNoteOwner rejects a reader who only has a share", async () => {
    mockPrisma.pageShare.findFirst.mockResolvedValue({ id: "sh-1" });
    await expect(requireNoteOwner("pg-1", OTHER)).rejects.toThrow(/owner/);
  });

  it("requireNoteOwner allows the owner", async () => {
    await expect(requireNoteOwner("pg-1", OWNER)).resolves.toBeUndefined();
  });
});

describe("listSharedWithMe", () => {
  it("asks only for other people's notes reached through a share", async () => {
    mockPrisma.page.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
    await listSharedWithMe(OTHER);

    const where = mockPrisma.page.findMany.mock.calls[0][0].where;
    expect(where.workspaceType).toBe("Member");
    expect(where.workspaceId).toEqual({ not: OTHER });
    // Deliberately NOT profileVisible/labListing: an inbox that filled up with
    // everything public would stop being an inbox.
    expect(JSON.stringify(where)).not.toContain("profileVisible");
    expect(JSON.stringify(where)).not.toContain("labListing");
  });

  it("labels each note with its owner", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "pg-1",
        title: "Handover",
        iconEmoji: null,
        kind: "FreeForm",
        parentPageId: null,
        workspaceId: OWNER,
        profileVisible: false,
        labListing: "None",
        updatedAt: new Date("2026-07-30T00:00:00.000Z"),
        tags: [],
        _count: { shares: 2 },
      },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: OWNER, firstName: "Ada", lastName: "Lovelace" },
    ]);
    const [note] = await listSharedWithMe(OTHER);
    expect(note).toMatchObject({
      title: "Handover",
      visibility: "private",
      shareCount: 2,
      owner: { id: OWNER, name: "Ada Lovelace" },
    });
  });
});
