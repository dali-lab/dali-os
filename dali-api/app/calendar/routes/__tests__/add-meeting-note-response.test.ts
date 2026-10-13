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
