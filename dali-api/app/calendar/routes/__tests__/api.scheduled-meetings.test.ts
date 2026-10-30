import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockNotePath = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server");
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

  it("accepts a new notebook with a template", async () => {
    const notebook = { title: "Standup", templatePageId: "tpl-1" };

    const res = await post({ ...noType, projectId: "p1", notebook });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ notebook, projectId: "p1" }));
  });

  it("rejects a notebook carrying a location or links", async () => {
    const location = { workspaceType: "Lab", workspaceId: null, parentPageId: "f2" };

    expect((await post({ ...noType, notebook: { title: "A", links: [location] } })).status).toBe(400);
    expect((await post({ ...noType, notebook: { existingId: "nb-1", location } })).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("answers without declined links or moves", async () => {
    const body = await (await post({ ...noType, notebook: { title: "Standup" } })).json();

    expect(body).not.toHaveProperty("declinedLinks");
    expect(body).not.toHaveProperty("declinedMove");
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

  it("drops a noteLocation instead of passing it on", async () => {
    const res = await post({
      meetingType: undefined,
      meetingTypeLabel: undefined,
      note: false,
      whiteboard: true,
      noteLocation: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" },
    });

    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("noteLocation");
  });
});
