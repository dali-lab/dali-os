// Personal notes are the member's private writing. An impersonating admin may
// not read, edit, delete, or reshare them.

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockCreateNote = vi.hoisted(() => vi.fn());
const mockDeleteNote = vi.hoisted(() => vi.fn());
const mockAddNoteShare = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: mockRequireAuth,
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listVisibleGroupsForUser: vi.fn() }));
vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/members/lib/personal-notes.server", () => ({
  NoteForbiddenError: class extends Error {},
  NoteNotFoundError: class extends Error {},
}));
vi.mock("~/members/lib/personal-notes-actions.server", () => ({
  addNoteShare: mockAddNoteShare,
  archiveNote: vi.fn(),
  createNote: mockCreateNote,
  deleteNote: mockDeleteNote,
  listNoteShares: vi.fn(),
  proposeLabListing: vi.fn(),
  removeNoteShare: vi.fn(),
  reviewLabListing: vi.fn(),
  setNoteVisibility: vi.fn(),
  updateNote: vi.fn(),
  withdrawLabListing: vi.fn(),
}));

import { action } from "~/members/routes/api.notes";

function post(intent: string, fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set("intent", intent);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://x/api/notes", { method: "POST", body });
}

function session(impersonatedBy?: string) {
  return {
    ok: true,
    user: { sub: "member-1", email: "m@dali.dartmouth.edu", type: "member" },
    sessionId: "s1",
    ...(impersonatedBy ? { impersonatedBy } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateNote.mockResolvedValue({ id: "pg-1" });
});

describe("POST /api/notes while impersonating", () => {
  it.each(["create", "delete", "share_add"])("403s the %s intent without touching the note", async (intent) => {
    mockRequireAuth.mockResolvedValue(session("admin-9"));

    const res = await action({ request: post(intent, { pageId: "pg-1", title: "x" }) } as never);

    expect(res.status).toBe(403);
    expect(mockCreateNote).not.toHaveBeenCalled();
    expect(mockDeleteNote).not.toHaveBeenCalled();
    expect(mockAddNoteShare).not.toHaveBeenCalled();
  });

  it("lets the member act on their own notes", async () => {
    mockRequireAuth.mockResolvedValue(session());

    const res = await action({ request: post("create", { title: "Mine" }) } as never);

    expect(res.status).not.toBe(403);
    expect(mockCreateNote).toHaveBeenCalledTimes(1);
  });
});
