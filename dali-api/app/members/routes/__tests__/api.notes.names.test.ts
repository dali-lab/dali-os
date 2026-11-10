import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockCreateNote = vi.hoisted(() => vi.fn());
const mockUpdateNote = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: mockRequireAuth,
}));
vi.mock("~/lib/cors", () => ({ withCors: (_req: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listVisibleGroupsForUser: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/members/lib/personal-notes.server", () => ({
  NoteForbiddenError: class extends Error {},
  NoteNotFoundError: class extends Error {},
}));
vi.mock("~/members/lib/personal-notes-actions.server", () => ({
  addNoteShare: vi.fn(),
  archiveNote: vi.fn(),
  createNote: mockCreateNote,
  deleteNote: vi.fn(),
  listNoteShares: vi.fn(),
  proposeLabListing: vi.fn(),
  removeNoteShare: vi.fn(),
  reviewLabListing: vi.fn(),
  setNoteVisibility: vi.fn(),
  updateNote: mockUpdateNote,
  withdrawLabListing: vi.fn(),
}));

import { PageNameConflictError } from "~/lib/page-names.server";
import { action } from "~/members/routes/api.notes";

function post(intent: string, fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set("intent", intent);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({ request: new Request("http://x/api/notes", { method: "POST", body }) } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: { sub: "member-1", email: "m@dali.dartmouth.edu", type: "member" },
    sessionId: "s1",
  });
});

describe("POST /api/notes names", () => {
  const taken = () => new PageNameConflictError("A document named “Ideas” already exists here");

  it("409s a create onto a taken name", async () => {
    mockCreateNote.mockRejectedValue(taken());
    const res = await post("create", { title: "Ideas" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A document named “Ideas” already exists here" });
  });

  it("409s a rename onto a taken name", async () => {
    mockUpdateNote.mockRejectedValue(taken());
    const res = await post("update", { pageId: "n1", title: "Ideas" });
    expect(res.status).toBe(409);
  });
});
