import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectApplicantToPortal: vi.fn().mockReturnValue(null),
}));
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  getUserRoles: vi.fn(),
  isProjectMember: vi.fn(),
}));
vi.mock("~/lib/wallet-token", () => ({ walletTokensConfigured: () => false }));
vi.mock("qrcode", () => ({ default: { toString: vi.fn().mockResolvedValue("<svg/>") } }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { action, loader } from "~/calendar/routes/calendar.meeting.$id";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockRoles = getUserRoles as ReturnType<typeof vi.fn>;
const mockIsProjectMember = isProjectMember as ReturnType<typeof vi.fn>;

function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Weekly sync",
    organizerId: "organizer-1",
    meetingType: "Team",
    meetingTypeLabel: null,
    attendanceMode: "Roster",
    projectId: "p1",
    selectedAt: new Date("2026-01-05T15:00:00.000Z"),
    durationMinutes: 60,
    status: "Scheduled",
    scopeType: "Project",
    isCoreMeeting: false,
    meetingUrl: null,
    participantUserIds: ["member-1"],
    organizer: { firstName: "Ada", lastName: "Lovelace" },
    // The case this is all about: a meeting that predates meeting notes.
    notePage: null,
    attendance: [
      { userId: "member-1", present: false, user: { firstName: "Bo", lastName: "Ng", daliEmail: null } },
    ],
    ...over,
  };
}

function load() {
  return loader({
    request: new Request(`http://localhost/calendar/meeting/m1`),
    params: { id: "m1" },
    context: {},
  } as never) as Promise<{ canAddNote: boolean; notePageId: string | null }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoles.mockResolvedValue({ isCore: false, isLabMember: true });
  mockIsProjectMember.mockResolvedValue(false);
  mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(meeting());
  mockPrisma.meetingTimeProposal.findMany.mockResolvedValue([]);
});

describe("meeting page — adding a note after the fact", () => {
  it("offers it to the organizer of a note-less meeting", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    const d = await load();
    expect(d.notePageId).toBeNull();
    expect(d.canAddNote).toBe(true);
  });

  it("offers it to Core", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "core-1", type: "member" } });
    mockRoles.mockResolvedValue({ isCore: true, isLabMember: true });
    expect((await load()).canAddNote).toBe(true);
  });

  it("withholds it from a project member, who may mark attendance but not file the doc", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockIsProjectMember.mockResolvedValue(true);
    expect((await load()).canAddNote).toBe(false);
  });

  it("withholds it from a plain invitee", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    expect((await load()).canAddNote).toBe(false);
  });
});

describe("meeting page — turning on self check-in later", () => {
  function enable() {
    const body = new FormData();
    body.set("intent", "enable-self-check-in");
    return action({
      request: new Request(`http://localhost/calendar/meeting/m1`, { method: "POST", body }),
      params: { id: "m1" },
      context: {},
    } as never) as Promise<Response>;
  }

  beforeEach(() => {
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});
    mockPrisma.meetingAttendance.createMany.mockResolvedValue({ count: 0 });
  });

  it("offers it to an organizer who may create self check-in events", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    mockRoles.mockResolvedValue({ isCore: false, isLabMember: true, canViewForms: true });
    expect(((await load()) as unknown as { canEnableSelfCheckIn: boolean }).canEnableSelfCheckIn).toBe(true);
  });

  it("switches the mode and backfills the roster", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    mockRoles.mockResolvedValue({ isCore: false, isLabMember: true, canViewForms: true });
    const res = await enable();
    expect(res.status).toBe(200);
    expect(mockPrisma.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { attendanceMode: "SelfCheckIn" },
    });
    expect(mockPrisma.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", userId: "member-1" },
        { scheduledMeetingId: "m1", userId: "organizer-1" },
      ],
      skipDuplicates: true,
    });
  });

  it("refuses an organizer without the self check-in role", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    mockRoles.mockResolvedValue({ isCore: false, isLabMember: true, canViewForms: false });
    expect((await enable()).status).toBe(403);
    expect(mockPrisma.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("refuses a project member who isn't the organizer", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockRoles.mockResolvedValue({ isCore: false, isLabMember: true, canViewForms: true });
    expect((await enable()).status).toBe(403);
  });
});
