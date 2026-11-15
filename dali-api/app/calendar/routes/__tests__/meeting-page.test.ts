import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn(async () => null),
  isNonMember: vi.fn(async () => false),
}));
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  getUserRoles: vi.fn(),
  isProjectMember: vi.fn(),
}));
vi.mock("~/wallet/lib/wallet-token.server", () => ({ walletTokensConfigured: () => false }));
vi.mock("~/lib/display-scan.server", () => ({
  getActiveDisplayScan: vi.fn(),
  startDisplayScan: vi.fn(),
  stopDisplayScan: vi.fn(),
}));
vi.mock("qrcode", () => ({ default: { toString: vi.fn().mockResolvedValue("<svg/>") } }));

import { prisma } from "~/lib/db.server";
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

describe("meeting page — a trashed series notebook", () => {
  const notebookOf = (archivedAt: Date | null) => ({ id: "nb1", title: "Sync notes", archivedAt });

  it("reads only live notes, shows no notebook and nothing to open while it is in Trash", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(
      meeting({ notebookId: "nb1", notebook: notebookOf(new Date("2026-01-10T00:00:00.000Z")), notePages: [] }),
    );

    const d = (await load()) as unknown as { notebook: { id: string } | null; canOpenNote: boolean };

    expect(d.notebook).toBeNull();
    expect(d.canOpenNote).toBe(false);
    expect(mockPrisma.scheduledMeeting.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ notePages: expect.objectContaining({ where: { archivedAt: null } }) }),
      }),
    );
  });

  it("links the notebook again once it is restored", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(
      meeting({ notebookId: "nb1", notebook: notebookOf(null), notePages: [] }),
    );

    const d = (await load()) as unknown as { notebook: { id: string; title: string } | null; canOpenNote: boolean };

    expect(d.notebook).toEqual({ id: "nb1", title: "Sync notes" });
    expect(d.canOpenNote).toBe(true);
  });
});

describe("meeting page — Core label", () => {
  it.each([true, false])("shows the stored isCoreMeeting column (%s)", async (isCoreMeeting) => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(meeting({ notebookId: "nb1", isCoreMeeting }));

    const d = (await load()) as unknown as { isCoreMeeting: boolean };

    expect(d.isCoreMeeting).toBe(isCoreMeeting);
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

  it("offers a participant the start-a-note affordance once the series has a notebook", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(
      meeting({ notebookId: "nb-1", notebook: { id: "nb-1", title: "Weekly" } }),
    );
    const d = (await load()) as unknown as { canAddNote: boolean; canStartNote: boolean };
    expect(d.canStartNote).toBe(true);
    expect(d.canAddNote).toBe(false);
  });

  it("offers a participant the affordance once a previous note exists", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(
      meeting({ notePages: [{ id: "n1", meetingOccurrenceStart: new Date("2025-12-29T15:00:00.000Z") }] }),
    );
    expect(((await load()) as unknown as { canStartNote: boolean }).canStartNote).toBe(true);
  });

  it("withholds it from a participant when the series has no notebook and no notes", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    expect(((await load()) as unknown as { canStartNote: boolean }).canStartNote).toBe(false);
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

describe("meeting page — access gate", () => {
  const status = async () => {
    const err = await load().catch((e) => e);
    return err instanceof Response ? err.status : "returned";
  };

  beforeEach(() => {
    vi.mocked(getActiveDisplayScan).mockResolvedValue(null);
  });

  it("404s a missing meeting", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);
    expect(await status()).toBe(404);
    expect(mockPrisma.meetingAttendance.findMany).not.toHaveBeenCalled();
  });

  it("404s a cancelled meeting", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "organizer-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(meeting({ status: "Cancelled" }));
    expect(await status()).toBe(404);
  });

  it("404s a lab member who is not invited, does not manage it, and it is not lab-wide", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "stranger-1", type: "member" } });
    expect(await status()).toBe(404);
  });

  it("opens a lab-wide meeting read-only to any lab member", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "stranger-1", type: "member" } });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(meeting({ scopeType: "None", projectId: null }));
    const d = (await load()) as unknown as { canManage: boolean };
    expect(d.canManage).toBe(false);
  });

  it("lets a project member in and manage, checking membership with the request", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "stranger-1", type: "member" } });
    mockIsProjectMember.mockResolvedValue(true);
    const d = (await load()) as unknown as { canManage: boolean };
    expect(d.canManage).toBe(true);
    expect(mockIsProjectMember).toHaveBeenCalledWith("stranger-1", "p1", expect.any(Request));
    expect(mockPrisma.meetingTimeProposal.findMany).toHaveBeenCalled();
  });

  it("does not read proposals or the door-display scan for a plain invitee", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    await load();
    expect(mockPrisma.meetingTimeProposal.findMany).not.toHaveBeenCalled();
    expect(getActiveDisplayScan).not.toHaveBeenCalled();
  });

  it("passes the request to getUserRoles", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    await load();
    expect(mockRoles).toHaveBeenCalledWith("member-1", expect.any(Request));
  });

  it("names whoever is recording right now", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
    mockPrisma.meetingRecording.findMany.mockResolvedValue([{ id: "rec1", userId: "u9", status: "Recording" }]);
    mockPrisma.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace", daliEmail: null });
    const d = (await load()) as unknown as { liveRecordingName: string | null; activeRecording: { id: string } | null };
    expect(d.liveRecordingName).toBe("Ada Lovelace");
    expect(d.activeRecording).toEqual({ id: "rec1", userId: "u9" });
  });
});
