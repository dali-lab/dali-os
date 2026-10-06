import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
vi.mock("~/lib/display-scan.server", () => ({
  getActiveDisplayScan: vi.fn(),
  startDisplayScan: vi.fn(),
  stopDisplayScan: vi.fn(),
}));
vi.mock("qrcode", () => ({ default: { toString: vi.fn().mockResolvedValue("<svg/>") } }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { getActiveDisplayScan, startDisplayScan, stopDisplayScan } from "~/lib/display-scan.server";
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
    createdAt: new Date("2026-01-01T12:00:00.000Z"),
    durationMinutes: 60,
    recurrenceRule: null,
    externalEventId: null,
    exceptions: [],
    status: "Scheduled",
    scopeType: "Project",
    isCoreMeeting: false,
    meetingUrl: null,
    participantUserIds: ["member-1"],
    organizer: { firstName: "Ada", lastName: "Lovelace" },
    // The case this is all about: a meeting that predates meeting notes.
    notePages: [],
    ...over,
  };
}

function load(query = "") {
  return loader({
    request: new Request(`http://localhost/calendar/meeting/m1${query}`),
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
  mockPrisma.meetingAttendance.findFirst.mockResolvedValue({ id: "row" });
  mockPrisma.meetingAttendance.findMany.mockResolvedValue([
    { userId: "member-1", present: false, user: { firstName: "Bo", lastName: "Ng", daliEmail: null } },
  ]);
});

describe("meeting page — one occurrence of a recurring meeting", () => {
  const weekly = () =>
    meeting({
      recurrenceRule: "FREQ=WEEKLY",
      notePages: [
        { id: "note-wk1", meetingOccurrenceStart: new Date("2026-01-05T15:00:00.000Z") },
        { id: "note-wk2", meetingOccurrenceStart: new Date("2026-01-12T15:00:00.000Z") },
      ],
    });

  it("opens the requested week's note and roster, with its neighbours", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(weekly());

    const d = (await load("?occurrence=2026-01-12T15:00:00.000Z")) as unknown as {
      notePageId: string | null;
      occurrenceStart: string;
      prevOccurrence: { start: string } | null;
      nextOccurrence: { start: string } | null;
    };

    expect(d.notePageId).toBe("note-wk2");
    expect(d.occurrenceStart).toBe("2026-01-12T15:00:00.000Z");
    expect(d.prevOccurrence?.start).toBe("2026-01-05T15:00:00.000Z");
    expect(d.nextOccurrence?.start).toBe("2026-01-19T15:00:00.000Z");
    // Week 2's roster, made on the spot from the invite list.
    expect(mockPrisma.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", occurrenceStart: new Date("2026-01-12T15:00:00.000Z"), userId: "member-1" },
        { scheduledMeetingId: "m1", occurrenceStart: new Date("2026-01-12T15:00:00.000Z"), userId: "organizer-1" },
      ],
      skipDuplicates: true,
    });
    expect(mockPrisma.meetingAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scheduledMeetingId: "m1", occurrenceStart: new Date("2026-01-12T15:00:00.000Z") },
      }),
    );
  });

  it("offers to start a week's note once the meeting keeps notes", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(weekly());

    const d = (await load("?occurrence=2026-01-19T15:00:00.000Z")) as unknown as {
      notePageId: string | null;
      canOpenNote: boolean;
    };

    expect(d.notePageId).toBeNull();
    expect(d.canOpenNote).toBe(true);
  });
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
    const occurrenceStart = new Date("2026-01-05T15:00:00.000Z");
    expect(mockPrisma.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", occurrenceStart, userId: "member-1" },
        { scheduledMeetingId: "m1", occurrenceStart, userId: "organizer-1" },
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

describe("meeting page — attendance tracking from iPad", () => {
  const occurrenceStart = "2026-01-05T15:00:00.000Z";
  function toggle(intent: string) {
    const body = new FormData();
    body.set("intent", intent);
    body.set("occurrenceStart", occurrenceStart);
    return action({
      request: new Request(`http://localhost/calendar/meeting/m1`, { method: "POST", body }),
      params: { id: "m1" },
      context: {},
    } as never) as Promise<Response>;
  }
  const ipadScan = async () => ((await load()) as unknown as { ipadScan: unknown }).ipadScan;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-01-05T14:00:00.000Z") });
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    vi.mocked(getActiveDisplayScan).mockResolvedValue(null);
    vi.mocked(startDisplayScan).mockResolvedValue({ ok: true, expiresAt: new Date(), displaced: null });
  });
  afterEach(() => vi.useRealTimers());

  it("offers it to the organizer", async () => {
    expect(await ipadScan()).toEqual({ on: false, busyWith: null, busyHref: null, ended: false });
  });

  it("shows it on for the occurrence that has the iPads", async () => {
    vi.mocked(getActiveDisplayScan).mockResolvedValue({
      meetingId: "m1",
      occurrenceStart: new Date(occurrenceStart),
      title: "Weekly sync",
      start: null,
      end: null,
      isEvent: false,
      startedBy: null,
      expiresAt: new Date(),
    });
    expect(await ipadScan()).toMatchObject({ on: true, busyWith: null });
  });

  it("names the other event holding the iPads", async () => {
    vi.mocked(getActiveDisplayScan).mockResolvedValue({
      meetingId: "m2",
      occurrenceStart: new Date(occurrenceStart),
      title: "Lab night",
      start: null,
      end: null,
      isEvent: true,
      startedBy: null,
      expiresAt: new Date(),
    });
    expect(await ipadScan()).toMatchObject({
      on: false,
      busyWith: "Lab night",
      busyHref: `/calendar/meeting/m2?occurrence=${encodeURIComponent(occurrenceStart)}`,
    });
  });

  it("takes the iPads over from the other event", async () => {
    vi.mocked(startDisplayScan).mockResolvedValue({ ok: true, expiresAt: new Date(), displaced: "Lab night" });
    const res = await toggle("takeover-ipad-scan");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, displaced: "Lab night" });
    expect(startDisplayScan).toHaveBeenCalledWith("m1", new Date(occurrenceStart), "organizer-1", {
      takeOver: true,
    });
  });

  it("withholds it from a project member", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockIsProjectMember.mockResolvedValue(true);
    expect(await ipadScan()).toBeNull();
    expect((await toggle("start-ipad-scan")).status).toBe(403);
    expect(startDisplayScan).not.toHaveBeenCalled();
  });

  it("starts and stops scanning for this occurrence", async () => {
    expect((await toggle("start-ipad-scan")).status).toBe(200);
    expect(startDisplayScan).toHaveBeenCalledWith("m1", new Date(occurrenceStart), "organizer-1", {
      takeOver: false,
    });
    expect((await toggle("stop-ipad-scan")).status).toBe(200);
    expect(stopDisplayScan).toHaveBeenCalledWith("m1");
  });

  it("passes through a refusal while another event has the iPads", async () => {
    vi.mocked(startDisplayScan).mockResolvedValue({ ok: false, error: "busy", status: 409 });
    expect((await toggle("start-ipad-scan")).status).toBe(409);
  });
});
