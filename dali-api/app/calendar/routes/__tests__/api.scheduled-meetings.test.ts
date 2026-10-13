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
