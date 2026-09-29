import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
}));

vi.mock("~/lib/display-scan.server", () => ({
  getActiveDisplayScan: vi.fn(),
  startDisplayScan: vi.fn(),
  stopDisplayScan: vi.fn(),
}));
vi.mock("~/rooms/lib/access.server", () => ({ isRoomBookingEnabled: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { startDisplayScan, stopDisplayScan } from "~/lib/display-scan.server";
import { isRoomBookingEnabled } from "~/rooms/lib/access.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { action } from "~/routes/attendance";

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

  it("rejects applicants outright", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "app-1", type: "applicant" } });

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

describe("POST /attendance: iPad scanning", () => {
  const occurrenceStart = "2026-09-30T22:00:00.000Z";
  const toggle = (intent: string) => post({ intent, meetingId: "meeting-1", occurrenceStart });

  beforeEach(() => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({ organizerId: "viewer-1", status: "Scheduled" });
    vi.mocked(isRoomBookingEnabled).mockResolvedValue(true);
    vi.mocked(startDisplayScan).mockResolvedValue({ expiresAt: new Date("2026-10-01T00:00:00Z") });
  });

  it("points the iPads at the organizer's event occurrence", async () => {
    expect((await toggle("start-ipad-scan")).status).toBe(200);
    expect(startDisplayScan).toHaveBeenCalledWith("meeting-1", new Date(occurrenceStart), "viewer-1");
  });

  it("stops scanning", async () => {
    expect((await toggle("stop-ipad-scan")).status).toBe(200);
    expect(stopDisplayScan).toHaveBeenCalledWith("meeting-1");
  });

  it("lets Core switch on scanning for someone else's event", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({ organizerId: "someone-else", status: "Scheduled" });
    mockIsCore.mockResolvedValue(true);
    expect((await toggle("start-ipad-scan")).status).toBe(200);
  });

  // Project members can mark attendance, but taking over every iPad in the lab
  // is the organizer's or Core's call.
  it("rejects a project member who doesn't organize the event", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({ organizerId: "someone-else", status: "Scheduled" });
    mockIsProjectMember.mockResolvedValue(true);
    expect((await toggle("start-ipad-scan")).status).toBe(403);
    expect(startDisplayScan).not.toHaveBeenCalled();
  });

  it("rejects when room booking is off", async () => {
    vi.mocked(isRoomBookingEnabled).mockResolvedValue(false);
    expect((await toggle("start-ipad-scan")).status).toBe(403);
  });

  it("409s once the event has ended", async () => {
    vi.mocked(startDisplayScan).mockResolvedValue(null);
    expect((await toggle("start-ipad-scan")).status).toBe(409);
  });

  it("409s a cancelled event", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({ organizerId: "viewer-1", status: "Cancelled" });
    expect((await toggle("start-ipad-scan")).status).toBe(409);
    expect(startDisplayScan).not.toHaveBeenCalled();
  });
});
