import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
}));
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { action, loader } from "~/routes/attendance";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockIsCore = isCore as ReturnType<typeof vi.fn>;
const mockIsProjectMember = isProjectMember as ReturnType<typeof vi.fn>;

function post(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const request = new Request("http://localhost/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return action({ request, params: {}, context: {} } as never) as Promise<Response>;
}

function saveNote(note: string) {
  return post({
    intent: "set-absence-note",
    meetingId: "meeting-1",
    userId: "absentee-1",
    note,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { sub: "viewer-1", type: "member" } });
  mockIsCore.mockResolvedValue(false);
  mockIsProjectMember.mockResolvedValue(false);
  mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
    id: "meeting-1",
    organizerId: "viewer-1",
    projectId: null,
  });
  mockPrisma.meetingAttendance.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /attendance — set-absence-note", () => {
  it("saves a trimmed note for the organizer", async () => {
    const res = await saveNote("  Excused — class conflict  ");
    expect(res.status).toBe(200);
    expect(mockPrisma.meetingAttendance.updateMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "meeting-1", userId: "absentee-1" },
      data: { absenceNote: "Excused — class conflict" },
    });
  });

  it("clears the note when the text is emptied", async () => {
    const res = await saveNote("   ");
    expect(res.status).toBe(200);
    expect(mockPrisma.meetingAttendance.updateMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "meeting-1", userId: "absentee-1" },
      data: { absenceNote: null },
    });
  });

  it("lets Core annotate a meeting they don't organize", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "meeting-1",
      organizerId: "someone-else",
      projectId: null,
    });
    mockIsCore.mockResolvedValue(true);

    expect((await saveNote("Excused")).status).toBe(200);
  });

  it("lets a project member annotate their project's meeting", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "meeting-1",
      organizerId: "someone-else",
      projectId: "project-1",
    });
    mockIsProjectMember.mockResolvedValue(true);

    expect((await saveNote("Excused")).status).toBe(200);
    expect(mockIsProjectMember).toHaveBeenCalledWith("viewer-1", "project-1");
  });

  // The page itself is visible to everyone invited, so a plain invitee reaching
  // the action directly must not be able to write on the roster.
  it("rejects an invitee who can't mark attendance", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "meeting-1",
      organizerId: "someone-else",
      projectId: null,
    });

    const res = await saveNote("Excused");
    expect(res.status).toBe(403);
    expect(mockPrisma.meetingAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("rejects non-members outright", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "app-1", type: "dartmouth" } });
    vi.mocked(isNonMember).mockResolvedValueOnce(true);

    expect((await saveNote("Excused")).status).toBe(403);
  });

  it("rejects a note longer than the cap", async () => {
    const res = await saveNote("x".repeat(281));
    expect(res.status).toBe(400);
    expect(mockPrisma.meetingAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("404s when the person isn't on the roster", async () => {
    mockPrisma.meetingAttendance.updateMany.mockResolvedValue({ count: 0 });

    expect((await saveNote("Excused")).status).toBe(404);
  });

  it("404s on an unknown meeting", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);

    expect((await saveNote("Excused")).status).toBe(404);
  });

  it("rejects an unknown intent", async () => {
    const res = await post({ intent: "delete-everything", meetingId: "m", userId: "u" });
    expect(res.status).toBe(400);
  });
});

describe("GET /attendance - scope label", () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: id,
    selectedAt: new Date("2026-10-01T15:00:00Z"),
    durationMinutes: 60,
    meetingType: "Other",
    meetingTypeLabel: "Sync",
    isCoreMeeting: false,
    notebookId: null,
    organizerId: "viewer-1",
    project: null,
    organizer: { firstName: "A", lastName: "B", daliEmail: null },
    exceptions: [],
    attendance: [
      {
        occurrenceStart: new Date("2026-10-01T15:00:00Z"),
        present: false,
        markedAt: null,
        absenceNote: null,
        userId: "viewer-1",
        user: { id: "viewer-1", firstName: "A", lastName: "B", daliEmail: null },
      },
    ],
    ...over,
  });

  it("labels a meeting Core by its isCoreMeeting column, a project meeting by its project, the rest General", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      row("flagged", { isCoreMeeting: true, notebookId: "nb1" }),
      row("unflagged-with-notebook", { notebookId: "nb2" }),
      row("project", { project: { id: "p1", name: "Atlas" }, isCoreMeeting: true, notebookId: "nb3" }),
      row("plain"),
    ]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);

    const { events } = (await loader({
      request: new Request("http://localhost/attendance"),
      params: {},
      context: {},
    } as never)) as { events: Array<{ meetingId: string; scope: string }> };

    expect(Object.fromEntries(events.map((e) => [e.meetingId, e.scope]))).toEqual({
      flagged: "Core",
      "unflagged-with-notebook": "General",
      project: "Atlas",
      plain: "General",
    });
  });
});
