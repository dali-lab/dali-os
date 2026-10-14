import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockNotePath = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: mockRequireAuth,
  isNonMember: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn().mockResolvedValue(false),
  isCore: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/groups", () => ({ isCoreGroup: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/rooms.server", () => ({ assertMeetingRoomsFree: vi.fn() }));
vi.mock("~/lib/scheduled-meeting", () => ({ createScheduledMeeting: mockCreate }));
vi.mock("~/lib/note-path.server", () => ({ meetingNotePath: mockNotePath }));

import { action } from "~/calendar/routes/api.scheduled-meetings";

function post(over: Record<string, unknown> = {}) {
  return action({
    request: new Request("http://x/api/scheduled-meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType: "None",
        title: "Weekly sync",
        durationMinutes: 30,
        meetingType: "Other",
        meetingTypeLabel: "Weekly sync",
        ...over,
      }),
    }),
  } as never);
}

const created = {
  ok: true,
  meeting: { id: "m1" },
  notifiedCount: 0,
  gcalError: null,
  notePageId: "note-1",
  notebookId: "nb-1",
  createdNotebook: true,
  whiteboardPageId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u1@dali.dartmouth.edu", type: "member" },
    sessionId: "s1",
  });
});

describe("POST /api/scheduled-meetings: filing details", () => {
  it("returns the note's path and whether its notebook was created by this request", async () => {
    mockCreate.mockResolvedValue(created);
    mockNotePath.mockResolvedValue({ label: "General ▸ Weekly sync notes", href: "/documents/note-1" });

    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      notePageId: "note-1",
      notebookId: "nb-1",
      createdNotebook: true,
      notePath: { label: "General ▸ Weekly sync notes", href: "/documents/note-1" },
    });
    expect(mockNotePath).toHaveBeenCalledWith(
      expect.objectContaining({ notePageId: "note-1", notebookId: "nb-1", viewerSub: "u1" }),
    );
  });

  it("reports a reused notebook as not created", async () => {
    mockCreate.mockResolvedValue({ ...created, createdNotebook: false });
    mockNotePath.mockResolvedValue({ label: "General ▸ Weekly sync notes", href: "/documents/note-1" });

    expect((await (await post()).json()).createdNotebook).toBe(false);
  });

  it("has no path when the meeting keeps no note", async () => {
    mockCreate.mockResolvedValue({ ...created, notePageId: null, notebookId: null, createdNotebook: false });

    const body = await (await post({ note: false })).json();

    expect(body.notePath).toBeNull();
    expect(body.createdNotebook).toBe(false);
    expect(mockNotePath).not.toHaveBeenCalled();
  });
});

describe("POST /api/scheduled-meetings: notebook choice", () => {
  const noType = { meetingType: undefined, meetingTypeLabel: undefined, note: true };

  beforeEach(() => {
    mockCreate.mockResolvedValue(created);
    mockNotePath.mockResolvedValue({ label: "General ▸ Weekly sync notes", href: "/documents/note-1" });
  });

  it("accepts an existing notebook with no meeting type and hands it to the creator", async () => {
    const res = await post({ ...noType, notebook: { existingId: "nb-9" } });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ notebook: { existingId: "nb-9" }, meetingType: undefined, createNote: true }),
    );
  });

  it("accepts a new notebook with a location and template", async () => {
    const notebook = {
      title: "Standup",
      location: { workspaceType: "Project", workspaceId: "p1", parentPageId: "f1" },
      templatePageId: "tpl-1",
    };

    const res = await post({ ...noType, projectId: "p1", notebook });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ notebook, projectId: "p1" }));
  });

  it("passes the notebook's links through and reports the ones that were declined", async () => {
    const links = [{ workspaceType: "Lab", workspaceId: null, parentPageId: "f2" }];
    const declinedLinks = [{ location: links[0], error: "You can't add to that folder" }];
    mockCreate.mockResolvedValue({ ...created, declinedLinks });

    const res = await post({ ...noType, notebook: { title: "Standup", links } });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ notebook: { title: "Standup", links }, request: expect.any(Request) }),
    );
    expect((await res.json()).declinedLinks).toEqual(declinedLinks);
  });

  it("passes the location to move an existing notebook to, and reports a refused move", async () => {
    const location = { workspaceType: "Lab", workspaceId: null, parentPageId: "f2" };
    const declinedMove = { location, error: "You can't edit that folder" };
    mockCreate.mockResolvedValue({ ...created, declinedMove });

    const res = await post({ ...noType, notebook: { existingId: "nb-1", location } });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ notebook: { existingId: "nb-1", location } }));
    expect((await res.json()).declinedMove).toEqual(declinedMove);
  });

  it("rejects more than eight links", async () => {
    const link = { workspaceType: "Lab", workspaceId: null, parentPageId: "f2" };

    expect((await post({ ...noType, notebook: { title: "A", links: Array(9).fill(link) } })).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("still accepts the older meetingType payload with no notebook", async () => {
    const res = await post();

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ meetingType: "Other", meetingTypeLabel: "Weekly sync", notebook: undefined }),
    );
  });

  it("rejects a notebook that is neither an id nor a named notebook", async () => {
    expect((await post({ ...noType, notebook: { nope: 1 } })).status).toBe(400);
    expect((await post({ ...noType, notebook: { title: "" } })).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a Project location with no project", async () => {
    const notebook = { title: "A", location: { workspaceType: "Project", workspaceId: null, parentPageId: null } };

    expect((await post({ ...noType, notebook })).status).toBe(400);
  });

  it("lets a whiteboard-only General meeting carry a noteLocation without naming a type", async () => {
    const res = await post({
      meetingType: undefined,
      meetingTypeLabel: undefined,
      note: false,
      whiteboard: true,
      noteLocation: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" },
    });

    expect(res.status).toBe(201);
  });

  it("accepts a project folder as a project meeting's noteLocation", async () => {
    const noteLocation = { workspaceType: "Project", workspaceId: "p1", parentPageId: "f1" };
    const res = await post({ meetingType: undefined, meetingTypeLabel: undefined, projectId: "p1", note: false, whiteboard: true, noteLocation });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", noteLocation }));
  });

  it("accepts the project's top level as the noteLocation", async () => {
    const res = await post({
      meetingType: undefined,
      meetingTypeLabel: undefined,
      projectId: "p1",
      noteLocation: { workspaceType: "Project", workspaceId: "p1", parentPageId: null },
    });

    expect(res.status).toBe(201);
  });

  it("refuses a noteLocation in a different project", async () => {
    const res = await post({
      meetingType: undefined,
      meetingTypeLabel: undefined,
      projectId: "p1",
      noteLocation: { workspaceType: "Project", workspaceId: "p2", parentPageId: "f1" },
    });

    expect(res.status).toBe(400);
  });

  it("refuses a Lab noteLocation on a project meeting", async () => {
    const res = await post({
      meetingType: undefined,
      meetingTypeLabel: undefined,
      projectId: "p1",
      noteLocation: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" },
    });

    expect(res.status).toBe(400);
  });

  it("still allows a project folder for a General meeting with no project", async () => {
    const res = await post({
      meetingType: undefined,
      meetingTypeLabel: undefined,
      noteLocation: { workspaceType: "Project", workspaceId: "p1", parentPageId: "f1" },
    });

    expect(res.status).toBe(201);
  });
});
