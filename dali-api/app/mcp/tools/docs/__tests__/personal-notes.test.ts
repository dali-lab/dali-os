import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub the registry so the BY_NAME map side-effect doesn't pull in every tool module.
vi.mock("~/mcp/registry", () => {
  class McpInvalidError extends Error {
    status: number;
    constructor(message = "Invalid params") { super(message); this.name = "McpInvalidError"; this.status = 400; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});
vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isLabMember: vi.fn() };
});
vi.mock("~/members/lib/personal-notes.server", () => ({
  noteAccess: vi.fn(),
  groupIdsForUser: vi.fn().mockResolvedValue([]),
  NoteNotFoundError: class NoteNotFoundError extends Error {
    constructor() { super("Note not found"); this.name = "NoteNotFoundError"; }
  },
  NoteForbiddenError: class NoteForbiddenError extends Error {
    constructor(m = "Forbidden") { super(m); this.name = "NoteForbiddenError"; }
  },
}));
vi.mock("~/members/lib/personal-notes-actions.server", () => ({
  createNote: vi.fn(),
  updateNote: vi.fn(),
  setNoteVisibility: vi.fn(),
  addNoteShare: vi.fn(),
  removeNoteShare: vi.fn(),
  deleteNote: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isLabMember } from "~/lib/roles";
import { noteAccess, NoteNotFoundError } from "~/members/lib/personal-notes.server";
import { createNote, deleteNote } from "~/members/lib/personal-notes-actions.server";
import {
  LIST_PERSONAL_NOTES_TOOL,
  GET_PERSONAL_NOTE_TOOL,
  MANAGE_PERSONAL_NOTE_TOOL,
  runListPersonalNotes,
  runGetPersonalNote,
  runManagePersonalNote,
  PersonalNoteError,
} from "~/mcp/tools/docs/personal-notes";

const mockPrisma = prisma as unknown as {
  page: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  user: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_personal_notes", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_PERSONAL_NOTES_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-lab-members", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    await expect(runListPersonalNotes("u1", {})).rejects.toMatchObject({
      name: "PersonalNoteError",
      status: 403,
    });
  });

  it("returns own notes for a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "n1", title: "My note", iconEmoji: null, kind: "FreeForm", parentPageId: null, workspaceId: "u1", profileVisible: false, labListing: "None", updatedAt: new Date("2026-01-01"), tags: [], _count: { shares: 0 } },
    ]);

    const out = await runListPersonalNotes("u1", { scope: "own" });
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toMatchObject({ id: "n1", visibility: "private", owner: null });
  });
});

describe("get_personal_note", () => {
  it("requires the mcp:read scope", () => {
    expect(GET_PERSONAL_NOTE_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns 404 when note is not found", async () => {
    vi.mocked(noteAccess).mockRejectedValue(new NoteNotFoundError());
    await expect(runGetPersonalNote("u1", { pageId: "missing" })).rejects.toMatchObject({
      name: "PersonalNoteError",
      status: 404,
    });
  });

  it("returns 403 when caller cannot view the note", async () => {
    vi.mocked(noteAccess).mockResolvedValue({ canView: false, canEdit: false, isOwner: false });
    await expect(runGetPersonalNote("u1", { pageId: "n1" })).rejects.toMatchObject({
      name: "PersonalNoteError",
      status: 403,
    });
  });

  it("returns note metadata for an authorized viewer", async () => {
    vi.mocked(noteAccess).mockResolvedValue({ canView: true, canEdit: false, isOwner: false });
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "n1", title: "Note", iconEmoji: null, kind: "FreeForm", parentPageId: null, workspaceId: "u2",
      profileVisible: true, labListing: "None", updatedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"),
      tags: [], _count: { shares: 1 },
    });

    const out = await runGetPersonalNote("u1", { pageId: "n1" });
    expect(out).toMatchObject({ id: "n1", visibility: "public", isOwner: false, canEdit: false });
  });
});

describe("manage_personal_note", () => {
  it("requires the mcp:write scope", () => {
    expect(MANAGE_PERSONAL_NOTE_TOOL.requiredScope).toBe("mcp:write");
  });

  it("creates a new note for the caller", async () => {
    vi.mocked(createNote).mockResolvedValue({ id: "new-note" } as never);
    const out = await runManagePersonalNote("u1", { action: "create", title: "New note" });
    expect(out).toEqual({ id: "new-note" });
    expect(createNote).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "New note" }));
  });

  it("requires pageId for delete", async () => {
    await expect(
      runManagePersonalNote("u1", { action: "delete" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("deletes a note when the caller owns it", async () => {
    vi.mocked(deleteNote).mockResolvedValue(undefined);
    const out = await runManagePersonalNote("u1", { action: "delete", pageId: "n1" });
    expect(out).toEqual({ ok: true });
    expect(deleteNote).toHaveBeenCalledWith("n1", "u1");
  });
});
