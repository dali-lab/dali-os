import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isCore: vi.fn(),
  isLabMember: vi.fn(),
  listVisibleGroupsForUser: vi.fn(),
  userFindMany: vi.fn(),
  actions: {
    addNoteShare: vi.fn(),
    archiveNote: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    listNoteShares: vi.fn(),
    proposeLabListing: vi.fn(),
    removeNoteShare: vi.fn(),
    reviewLabListing: vi.fn(),
    setNoteVisibility: vi.fn(),
    updateNote: vi.fn(),
    withdrawLabListing: vi.fn(),
  },
}));

vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: h.requireAuth,
}));
vi.mock("~/lib/cors", () => ({ withCors: (_r: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/roles", () => ({ isCore: h.isCore, isLabMember: h.isLabMember }));
vi.mock("~/lib/groups.server", () => ({ listVisibleGroupsForUser: h.listVisibleGroupsForUser }));
vi.mock("~/lib/db.server", () => ({ prisma: { user: { findMany: h.userFindMany } } }));
vi.mock("~/members/lib/personal-notes.server", () => {
  class NoteForbiddenError extends Error {}
  class NoteNotFoundError extends Error {
    constructor() {
      super("Note not found");
    }
  }
  return { NoteForbiddenError, NoteNotFoundError };
});
vi.mock("~/members/lib/personal-notes-actions.server", () => h.actions);

import { NoteForbiddenError, NoteNotFoundError } from "~/members/lib/personal-notes.server";
import { action } from "~/members/routes/api.notes";

function post(intent: string, fields: Record<string, string> = {}, method = "POST") {
  const body = new FormData();
  body.set("intent", intent);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://x/api/notes", { method, ...(method === "POST" ? { body } : {}) }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  h.requireAuth.mockResolvedValue({
    ok: true,
    user: { sub: "me", email: "ada@example.edu", type: "member" },
    sessionId: "s1",
  });
  h.isCore.mockResolvedValue(false);
  h.isLabMember.mockResolvedValue(true);
  h.listVisibleGroupsForUser.mockResolvedValue([]);
  h.userFindMany.mockResolvedValue([]);
});

describe("POST /api/notes gating", () => {
  it("405s anything but POST", async () => {
    const res = await post("create", {}, "GET");
    expect(res.status).toBe(405);
  });

  it("returns the auth failure response when signed out", async () => {
    h.requireAuth.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    const res = await post("create");
    expect(res.status).toBe(401);
    expect(h.actions.createNote).not.toHaveBeenCalled();
  });

  it("400s an unknown intent", async () => {
    expect((await post("explode")).status).toBe(400);
  });
});

describe("POST /api/notes acts as the session user, never a form-supplied owner", () => {
  it("creates in the caller's space and ignores an ownerId field", async () => {
    h.actions.createNote.mockResolvedValue({ id: "n1" });
    const res = await post("create", { ownerId: "someone-else", title: "Ideas", parentPageId: "" });
    expect(h.actions.createNote).toHaveBeenCalledWith("me", {
      title: "Ideas",
      parentPageId: null,
      isFolder: false,
      kind: undefined,
    });
    expect(await res.json()).toEqual({ ok: true, id: "n1" });
  });

  it("only honours the Whiteboard and Slides kinds", async () => {
    h.actions.createNote.mockResolvedValue({ id: "n1" });
    await post("create", { kind: "Slides" });
    await post("create", { kind: "Folder" });
    expect(h.actions.createNote.mock.calls.map((c) => c[1].kind)).toEqual(["Slides", undefined]);
  });

  it.each([
    ["archive", "archiveNote", {}],
    ["delete", "deleteNote", {}],
    ["withdraw", "withdrawLabListing", {}],
  ] as const)("%s passes (pageId, session user)", async (intent, fn, extra) => {
    await post(intent, { pageId: "n9", ...extra });
    expect(h.actions[fn]).toHaveBeenCalledWith("n9", "me");
  });

  it("visibility is public only for the literal 'true'", async () => {
    await post("visibility", { pageId: "n1", public: "true" });
    await post("visibility", { pageId: "n1", public: "yes" });
    expect(h.actions.setNoteVisibility.mock.calls).toEqual([
      ["n1", "me", true],
      ["n1", "me", false],
    ]);
  });

  it("update forwards only the fields that were sent (absent means untouched, present-empty means clear)", async () => {
    await post("update", { pageId: "n1", title: "T" });
    await post("update", { pageId: "n1", iconEmoji: "", parentPageId: "" });
    expect(h.actions.updateNote.mock.calls[0]).toEqual([
      "n1",
      "me",
      { title: "T", iconEmoji: undefined, parentPageId: undefined },
    ]);
    expect(h.actions.updateNote.mock.calls[1]).toEqual([
      "n1",
      "me",
      { title: undefined, iconEmoji: "", parentPageId: "" },
    ]);
  });

  it("propose passes the note text, or null", async () => {
    await post("propose", { pageId: "n1", note: "good one" });
    await post("propose", { pageId: "n1" });
    expect(h.actions.proposeLabListing.mock.calls).toEqual([
      ["n1", "me", "good one"],
      ["n1", "me", null],
    ]);
  });
});

describe("sharing intents", () => {
  it("lists shares for the caller's note", async () => {
    h.actions.listNoteShares.mockResolvedValue([{ id: "s1" }]);
    const res = await post("shares", { pageId: "n1" });
    expect(h.actions.listNoteShares).toHaveBeenCalledWith("n1", "me");
    expect(await res.json()).toEqual({ ok: true, shares: [{ id: "s1" }] });
  });

  it("share-add 400s with no principal", async () => {
    const res = await post("share-add", { pageId: "n1" });
    expect(res.status).toBe(400);
    expect(h.actions.addNoteShare).not.toHaveBeenCalled();
  });

  it("share-add treats anything but 'Group' as a User principal", async () => {
    h.actions.addNoteShare.mockResolvedValue({ ok: true, alreadyShared: false });
    await post("share-add", { pageId: "n1", principalId: "g1", principalType: "Group" });
    await post("share-add", { pageId: "n1", principalId: "u2", principalType: "Admin" });
    expect(h.actions.addNoteShare.mock.calls).toEqual([
      ["n1", "me", "Group", "g1"],
      ["n1", "me", "User", "u2"],
    ]);
  });

  it("share-remove passes the share id", async () => {
    await post("share-remove", { pageId: "n1", shareId: "s7" });
    expect(h.actions.removeNoteShare).toHaveBeenCalledWith("n1", "me", "s7");
  });
});

describe("share-options (the share picker must not be a directory dump)", () => {
  it("403s a non-lab-member", async () => {
    h.isLabMember.mockResolvedValue(false);
    const res = await post("share-options", { q: "gr" });
    expect(res.status).toBe(403);
    expect(h.userFindMany).not.toHaveBeenCalled();
  });

  it("does not search for queries shorter than two characters", async () => {
    h.listVisibleGroupsForUser.mockResolvedValue([{ id: "g1", name: "Design" }]);
    const res = await post("share-options", { q: " g " });
    expect(h.userFindMany).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, members: [], groups: [{ id: "g1", label: "Design" }] });
  });

  it("searches lab members only, excluding the caller, capped at 8", async () => {
    h.userFindMany.mockResolvedValue([{ id: "u2", firstName: "Grace", lastName: "Hopper" }]);
    const res = await post("share-options", { q: "gra" });
    const args = h.userFindMany.mock.calls[0][0];
    expect(args.where.id).toEqual({ not: "me" });
    expect(args.where.daliMember).toEqual({ isNot: null });
    expect(args.take).toBe(8);
    expect(await res.json()).toMatchObject({ members: [{ id: "u2", label: "Grace Hopper" }] });
  });
});

describe("review (Core only)", () => {
  it("403s a non-Core member without reviewing", async () => {
    const res = await post("review", { pageId: "n1", decision: "Listed" });
    expect(res.status).toBe(403);
    expect(h.actions.reviewLabListing).not.toHaveBeenCalled();
  });

  it("lets Core list, and treats any other decision value as Declined", async () => {
    h.isCore.mockResolvedValue(true);
    await post("review", { pageId: "n1", decision: "Listed" });
    await post("review", { pageId: "n1", decision: "whatever" });
    expect(h.actions.reviewLabListing.mock.calls).toEqual([
      ["n1", "me", "Listed"],
      ["n1", "me", "Declined"],
    ]);
  });
});

describe("error mapping", () => {
  it("404s a note that isn't the caller's (not-found, not forbidden, so existence isn't leaked)", async () => {
    h.actions.deleteNote.mockRejectedValue(new NoteNotFoundError());
    const res = await post("delete", { pageId: "theirs" });
    expect(res.status).toBe(404);
  });

  it("403s a forbidden action with its message", async () => {
    h.actions.archiveNote.mockRejectedValue(new NoteForbiddenError("This folder still holds 1 note(s)"));
    const res = await post("archive", { pageId: "n1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This folder still holds 1 note(s)" });
  });

  it("rethrows unexpected errors", async () => {
    h.actions.deleteNote.mockRejectedValue(new Error("db down"));
    await expect(post("delete", { pageId: "n1" })).rejects.toThrow("db down");
  });
});
