import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockAttach = vi.hoisted(() => vi.fn());
const mockNotePath = vi.hoisted(() => vi.fn());

// calendar.server pulls in the Prisma client; CI has no generated client.
vi.mock("~/lib/db");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: mockRequireAuth,
}));
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  isLabMember: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/lib/scheduled-meeting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/scheduled-meeting")>()),
  attachMeetingNote: mockAttach,
}));
vi.mock("~/lib/note-path.server", () => ({ meetingNotePath: mockNotePath }));

import { submitCalendarAction } from "~/calendar/routes/calendar.server";

async function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return (await submitCalendarAction(new Request("http://x/calendar", { method: "POST", body })))!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u1@dali.dartmouth.edu", type: "member" },
    sessionId: "s1",
  });
});

describe("add-meeting-note action response", () => {
  it("returns where the note was filed and whether its notebook is new", async () => {
    mockAttach.mockResolvedValue({
      ok: true,
      notePageId: "note-1",
      notebookId: "nb-1",
      createdNotebook: true,
    });
    mockNotePath.mockResolvedValue({ label: "Core ▸ Weekly sync notes", href: "/documents/note-1" });

    const res = await post({ intent: "add-meeting-note", meetingId: "m1" });

    expect(await res.json()).toEqual({
      ok: true,
      notePageId: "note-1",
      notebookId: "nb-1",
      createdNotebook: true,
      notePath: { label: "Core ▸ Weekly sync notes", href: "/documents/note-1" },
    });
    expect(mockNotePath).toHaveBeenCalledWith(
      expect.objectContaining({ notePageId: "note-1", notebookId: "nb-1", viewerSub: "u1" }),
    );
  });

  it("reports a reused notebook as not created", async () => {
    mockAttach.mockResolvedValue({
      ok: true,
      notePageId: "note-2",
      notebookId: "nb-1",
      createdNotebook: false,
    });
    mockNotePath.mockResolvedValue({ label: "Core ▸ Weekly sync notes", href: "/documents/note-2" });

    const body = await (await post({ intent: "add-meeting-note", meetingId: "m1" })).json();

    expect(body.createdNotebook).toBe(false);
    expect(body.notebookId).toBe("nb-1");
  });

  it("returns the error and no path when the note could not be added", async () => {
    mockAttach.mockResolvedValue({ ok: false, error: "Only the organizer or Core can add notes", status: 403 });

    const res = await post({ intent: "add-meeting-note", meetingId: "m1" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the organizer or Core can add notes" });
    expect(mockNotePath).not.toHaveBeenCalled();
  });
});

describe("add-meeting-note action notebook choice", () => {
  const filed = { ok: true, notePageId: "note-1", notebookId: "nb-1", createdNotebook: false, seriesNotebookId: "nb-s" };

  beforeEach(() => {
    mockAttach.mockResolvedValue(filed);
    mockNotePath.mockResolvedValue({ label: "Core ▸ Weekly", href: "/documents/note-1" });
  });

  it("passes an existing-notebook choice through to attachMeetingNote", async () => {
    await post({ intent: "add-meeting-note", meetingId: "m1", notebook: JSON.stringify({ existingId: "nb-1" }) });

    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ notebook: { existingId: "nb-1" } }));
  });

  it("passes a new-notebook choice through", async () => {
    const notebook = {
      title: "Retro",
      location: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" },
      templatePageId: "tpl",
    };

    await post({ intent: "add-meeting-note", meetingId: "m1", projectId: "p1", notebook: JSON.stringify(notebook) });

    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ notebook, projectId: "p1" }));
  });

  it("passes links through with the request, and returns the links that were declined", async () => {
    const links = [{ workspaceType: "Lab", workspaceId: null, parentPageId: "f2" }];
    const declinedLinks = [{ location: links[0], error: "You can't add to that folder" }];
    mockAttach.mockResolvedValue({ ...filed, declinedLinks });

    const res = await post({
      intent: "add-meeting-note",
      meetingId: "m1",
      notebook: JSON.stringify({ existingId: "nb-1", links }),
    });

    expect(mockAttach).toHaveBeenCalledWith(
      expect.objectContaining({ notebook: { existingId: "nb-1", links }, request: expect.any(Request) }),
    );
    expect((await res.json()).declinedLinks).toEqual(declinedLinks);
  });

  it("passes the location to move an existing notebook to, and returns a refused move", async () => {
    const location = { workspaceType: "Lab", workspaceId: null, parentPageId: "f2" };
    const declinedMove = { location, error: "You can't edit that folder" };
    mockAttach.mockResolvedValue({ ...filed, declinedMove });

    const res = await post({
      intent: "add-meeting-note",
      meetingId: "m1",
      notebook: JSON.stringify({ existingId: "nb-1", location }),
    });

    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ notebook: { existingId: "nb-1", location } }));
    expect((await res.json()).declinedMove).toEqual(declinedMove);
  });

  it("passes no notebook when the field is absent, so the series default decides", async () => {
    await post({ intent: "add-meeting-note", meetingId: "m1" });

    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ notebook: null }));
  });

  it("returns the series default so the client can offer to change it", async () => {
    const body = await (await post({ intent: "add-meeting-note", meetingId: "m1" })).json();

    expect(body).toMatchObject({ notebookId: "nb-1", seriesNotebookId: "nb-s" });
  });

  it("rejects a notebook choice that is neither shape", async () => {
    const res = await post({ intent: "add-meeting-note", meetingId: "m1", notebook: JSON.stringify({ nope: true }) });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockAttach).not.toHaveBeenCalled();
  });
});
