import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
const requireMobileUser = vi.fn();
const getUserRoles = vi.fn();
const isFeatureEnabled = vi.fn();
const isTranscriptionEnabled = vi.fn();
const createNote = vi.fn();
const readDocAsBlocks = vi.fn();
const canReadRecording = vi.fn();
const canRecordInto = vi.fn();
const resolveSpeakerNames = vi.fn();
const resolveMeetingOccurrence = vi.fn();
const runEnhanceMeetingNotes = vi.fn();
const attachMeetingNote = vi.fn();

vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: (...a: unknown[]) => getUserRoles(...a) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) }));
vi.mock("~/lib/transcription/provider", () => ({ isTranscriptionEnabled: () => isTranscriptionEnabled() }));
vi.mock("~/members/lib/personal-notes-actions.server", () => ({ createNote: (...a: unknown[]) => createNote(...a) }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: (...a: unknown[]) => readDocAsBlocks(...a) }));
vi.mock("~/lib/scheduled-meeting", () => ({
  resolveMeetingOccurrence: (...a: unknown[]) => resolveMeetingOccurrence(...a),
  attachMeetingNote: (...a: unknown[]) => attachMeetingNote(...a),
}));
vi.mock("~/lib/meeting-recording.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/meeting-recording.server")>()),
  canReadRecording: (...a: unknown[]) => canReadRecording(...a),
  canRecordInto: (...a: unknown[]) => canRecordInto(...a),
  resolveSpeakerNames: (...a: unknown[]) => resolveSpeakerNames(...a),
}));
vi.mock("~/mcp/tools/calendar-extra/enhance-meeting-notes", () => ({
  runEnhanceMeetingNotes: (...a: unknown[]) => runEnhanceMeetingNotes(...a),
}));

import { prisma } from "~/lib/db";
import { McpError } from "~/mcp/errors";
import { PageNameConflictError } from "~/lib/page-names.server";
import { loader as listLoader, action as quickNote } from "../api.mobile.notes";
import { loader as detailLoader, action as detailAction } from "../api.mobile.notes.$id";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const post = (path: string, body: unknown) =>
  new Request(`https://os.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const recording = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  userId: "u1",
  documentName: "doc:pg1:body",
  status: "Done",
  error: null,
  createdAt: new Date("2026-10-20T18:00:00.000Z"),
  recordedSeconds: 3420,
  scheduledMeetingId: null,
  occurrenceStart: null,
  enhancedAt: null,
  notes: null,
  speakers: {},
  lines: [],
  scheduledMeeting: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1" });
  getUserRoles.mockResolvedValue({ isLabMember: true });
  isFeatureEnabled.mockResolvedValue(true);
  isTranscriptionEnabled.mockReturnValue(true);
  mockPrisma.page.findMany.mockResolvedValue([]);
  canReadRecording.mockResolvedValue("owner");
  canRecordInto.mockResolvedValue(true);
  resolveSpeakerNames.mockResolvedValue({});
  readDocAsBlocks.mockResolvedValue([]);
});

describe("GET /api/mobile/notes", () => {
  it("lists the member's recordings with titles and action item counts", async () => {
    mockPrisma.meetingRecording.findMany.mockResolvedValue([
      recording({
        id: "r1",
        scheduledMeetingId: "m1",
        occurrenceStart: new Date("2026-10-20T18:00:00.000Z"),
        scheduledMeeting: { title: "DALI OS Meeting" },
        notes: { plan: { blocks: [], actionItems: [{ text: "a", taskId: "t1" }, { text: "b" }] } },
      }),
      recording({ id: "r2", documentName: "doc:pg2:body", status: "Processing" }),
      recording({ id: "r3", documentName: "project:p1:readme" }),
    ]);
    mockPrisma.page.findMany.mockResolvedValue([{ id: "pg2", title: "Quick note" }]);

    const res = (await listLoader({ request: new Request("https://os.example/api/mobile/notes") } as never)) as Response;
    const body = await res.json();

    expect(body.recordingEnabled).toBe(true);
    expect(body.notes).toEqual([
      expect.objectContaining({
        id: "r1",
        title: "DALI OS Meeting",
        status: "Done",
        scheduledMeetingId: "m1",
        occurrenceStart: "2026-10-20T18:00:00.000Z",
        actionItemCount: 2,
        tasksCreated: 1,
      }),
      expect.objectContaining({ id: "r2", title: "Quick note", status: "Processing", actionItemCount: 0 }),
      expect.objectContaining({ id: "r3", title: "Untitled" }),
    ]);
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["pg1", "pg2"] } },
      select: { id: true, title: true },
    });
    expect(mockPrisma.meetingRecording.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" }, take: 30 }),
    );
  });

  it("lists the member's typed notes after their recordings, once each", async () => {
    mockPrisma.meetingRecording.findMany.mockResolvedValue([recording({ id: "r1", documentName: "doc:pg1:body" })]);
    mockPrisma.page.findMany.mockImplementation(async (args: { where: { createdById?: string } }) =>
      args.where.createdById
        ? [
            { id: "pg1", title: "Recorded", updatedAt: new Date("2026-10-21T10:00:00.000Z"), parent: null },
            { id: "pg5", title: "Sprint retro", updatedAt: new Date("2026-10-21T09:00:00.000Z"), parent: { kind: "Notebook", title: "DALI OS team" } },
            { id: "pg6", title: "Ideas", updatedAt: new Date("2026-10-20T09:00:00.000Z"), parent: { kind: "Folder", title: "Stuff" } },
          ]
        : [{ id: "pg1", title: "Recorded" }],
    );

    const res = (await listLoader({ request: new Request("https://os.example/api/mobile/notes") } as never)) as Response;
    const body = await res.json();

    expect(body.pages).toEqual([
      { id: "pg5", title: "Sprint retro", updatedAt: "2026-10-21T09:00:00.000Z", notebook: "DALI OS team" },
      { id: "pg6", title: "Ideas", updatedAt: "2026-10-20T09:00:00.000Z", notebook: null },
    ]);
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdById: "u1",
          kind: "FreeForm",
          archivedAt: null,
          OR: [{ workspaceType: "Member", workspaceId: "u1" }, { parent: { kind: "Notebook" } }],
        },
      }),
    );
  });

  it.each([
    ["the AI notes flag is off", () => isFeatureEnabled.mockResolvedValue(false)],
    ["transcription isn't configured", () => isTranscriptionEnabled.mockReturnValue(false)],
  ])("says recording is off when %s", async (_label, arrange) => {
    arrange();
    mockPrisma.meetingRecording.findMany.mockResolvedValue([]);
    const res = (await listLoader({ request: new Request("https://os.example/api/mobile/notes") } as never)) as Response;
    expect((await res.json()).recordingEnabled).toBe(false);
  });
});

describe("POST /api/mobile/notes (a page to take notes in)", () => {
  it("creates a personal note and returns its collab room", async () => {
    createNote.mockResolvedValue({ id: "pg9" });
    const res = (await quickNote({ request: post("/api/mobile/notes", { title: "Quick note · Oct 22" }) } as never)) as Response;
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pageId: "pg9", documentName: "doc:pg9:body" });
    expect(createNote).toHaveBeenCalledWith("u1", { title: "Quick note · Oct 22" });
  });

  it("creates a typed note even when recording is off for the member", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    createNote.mockResolvedValue({ id: "pg9" });
    const res = (await quickNote({ request: post("/api/mobile/notes", { title: "x" }) } as never)) as Response;
    expect(res.status).toBe(201);
  });

  it("opens a calendar meeting occurrence's notes page", async () => {
    attachMeetingNote.mockResolvedValue({ ok: true, notePageId: "pg7" });
    const res = (await quickNote({
      request: post("/api/mobile/notes", { scheduledMeetingId: "m1", occurrenceStart: "2026-10-20T18:00:00.000Z" }),
    } as never)) as Response;
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pageId: "pg7", documentName: "doc:pg7:body" });
    expect(attachMeetingNote).toHaveBeenCalledWith({
      meetingId: "m1",
      actorId: "u1",
      occurrence: new Date("2026-10-20T18:00:00.000Z"),
    });
    expect(createNote).not.toHaveBeenCalled();
  });

  it("passes the meeting's refusal on", async () => {
    attachMeetingNote.mockResolvedValue({ ok: false, error: "Meeting not found", status: 404 });
    const res = (await quickNote({
      request: post("/api/mobile/notes", { scheduledMeetingId: "m1", occurrenceStart: "2026-10-20T18:00:00.000Z" }),
    } as never)) as Response;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Meeting not found" });
  });

  it("rejects a meeting without a valid occurrence", async () => {
    const res = (await quickNote({ request: post("/api/mobile/notes", { scheduledMeetingId: "m1", occurrenceStart: "soon" }) } as never)) as Response;
    expect(res.status).toBe(400);
    expect(attachMeetingNote).not.toHaveBeenCalled();
  });

  it("answers 409 when a note with that title already exists", async () => {
    createNote.mockRejectedValue(new PageNameConflictError({ id: "p", title: "x", kind: "FreeForm" } as never));
    const res = (await quickNote({ request: post("/api/mobile/notes", { title: "x" }) } as never)) as Response;
    expect(res.status).toBe(409);
  });

  it("requires a title", async () => {
    const res = (await quickNote({ request: post("/api/mobile/notes", { title: "  " }) } as never)) as Response;
    expect(res.status).toBe(400);
  });
});

describe("GET /api/mobile/notes/:id", () => {
  const load = () =>
    detailLoader({ request: new Request("https://os.example/api/mobile/notes/r1"), params: { id: "r1" } } as never) as Promise<Response>;

  it("404s a recording the member can't read", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording());
    canReadRecording.mockResolvedValue(null);
    expect((await load()).status).toBe(404);
  });

  it("404s a missing recording", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(null);
    expect((await load()).status).toBe(404);
  });

  it("returns the note outline, action items, transcript and project", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(
      recording({
        speakers: { "mic:1": "u2" },
        lines: [{ at: 4, end: 12, text: "Welcome", channel: "mic", speaker: "mic:1" }, { at: 13, text: "Hi" }],
        notes: { plan: { blocks: [], actionItems: [{ text: "Fill in Guides", ownerUserId: "u1" }] } },
        enhancedAt: new Date("2026-10-20T19:02:00.000Z"),
      }),
    );
    mockPrisma.page.findUnique.mockResolvedValue({ title: "Sprint 6 notes", workspaceType: "Project", workspaceId: "p1" });
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", name: "DALI OS" });
    resolveSpeakerNames.mockResolvedValue({ "mic:1": "Kiran" });
    readDocAsBlocks.mockResolvedValue([
      { id: "b", type: "paragraph", props: {}, content: [{ type: "text", text: "Kickoff", styles: {} }], children: [] },
    ]);

    const body = await (await load()).json();

    expect(body).toMatchObject({
      id: "r1",
      title: "Sprint 6 notes",
      status: "Done",
      isOwner: true,
      canEdit: true,
      enhancedAt: "2026-10-20T19:02:00.000Z",
      pageId: "pg1",
      pagePath: "/documents/pg1",
      project: { id: "p1", name: "DALI OS" },
      meeting: null,
      outline: [{ kind: "text", text: "Kickoff", depth: 0 }],
      actionItems: [{ index: 0, text: "Fill in Guides", ownerUserId: "u1", taskId: null }],
      speakerNames: { "mic:1": "Kiran" },
      lines: [
        { at: 4, end: 12, text: "Welcome", speaker: "mic:1" },
        { at: 13, end: 13, text: "Hi", speaker: null },
      ],
    });
    expect(readDocAsBlocks).toHaveBeenCalledWith("doc:pg1:body");
  });

  it("doesn't read the page before the recording is done", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ status: "Processing" }));
    mockPrisma.page.findUnique.mockResolvedValue({ title: "Notes", workspaceType: "Member", workspaceId: "u1" });
    const body = await (await load()).json();
    expect(body.outline).toEqual([]);
    expect(body.project).toBeNull();
    expect(readDocAsBlocks).not.toHaveBeenCalled();
  });

  it("shows a failed recording's error", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ status: "Failed", error: "No audio" }));
    mockPrisma.page.findUnique.mockResolvedValue(null);
    expect(await (await load()).json()).toMatchObject({ status: "Failed", error: "No audio" });
  });

  it("includes the meeting's occurrence and whether it is on the member's timesheet", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(
      recording({ scheduledMeetingId: "m1", occurrenceStart: new Date("2026-10-20T18:00:00.000Z") }),
    );
    mockPrisma.page.findUnique.mockResolvedValue(null);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      title: "DALI OS Meeting",
      selectedAt: new Date("2026-09-01T18:00:00.000Z"),
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      durationMinutes: 60,
      recurrenceRule: "FREQ=WEEKLY",
      externalEventId: null,
    });
    resolveMeetingOccurrence.mockResolvedValue({
      originalStart: new Date("2026-10-20T18:00:00.000Z"),
      start: new Date("2026-10-20T18:00:00.000Z"),
      end: new Date("2026-10-20T19:00:00.000Z"),
    });
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ id: "te1", hours: 1, roleRefId: "pa1" });

    const body = await (await load()).json();

    expect(body.title).toBe("DALI OS Meeting");
    expect(body.meeting).toEqual({
      id: "m1",
      title: "DALI OS Meeting",
      start: "2026-10-20T18:00:00.000Z",
      end: "2026-10-20T19:00:00.000Z",
      occurrenceStart: "2026-10-20T18:00:00.000Z",
      timeEntry: { id: "te1", hours: 1, roleRefId: "pa1" },
    });
    expect(mockPrisma.timeEntry.findUnique).toHaveBeenCalledWith({
      where: {
        scheduledMeetingId_occurrenceStart_userId: {
          scheduledMeetingId: "m1",
          occurrenceStart: new Date("2026-10-20T18:00:00.000Z"),
          userId: "u1",
        },
      },
      select: { id: true, hours: true, roleRefId: true },
    });
  });

  it("leaves out a meeting that has no scheduled time", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ scheduledMeetingId: "m1" }));
    mockPrisma.page.findUnique.mockResolvedValue(null);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({ id: "m1", title: "Poll", selectedAt: null });
    expect((await (await load()).json()).meeting).toBeNull();
  });
});

describe("POST /api/mobile/notes/:id", () => {
  const user = { daliEmail: "a@dali", dartmouthEmail: null, netId: "f00", firstName: "Sophie", lastName: "Park" };
  const enhance = (body: unknown = { action: "enhance" }) =>
    detailAction({ request: post("/api/mobile/notes/r1", body), params: { id: "r1" } } as never) as Promise<Response>;

  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue(user);
    runEnhanceMeetingNotes.mockResolvedValue({});
  });

  it("previews, then applies, Enhance as the member", async () => {
    const res = await enhance();
    expect(await res.json()).toEqual({ ok: true });
    expect(runEnhanceMeetingNotes).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ user: { id: "u1", ...user } }),
      { recordingId: "r1" },
    );
    expect(runEnhanceMeetingNotes).toHaveBeenNthCalledWith(2, expect.anything(), { recordingId: "r1", apply: true });
  });

  it("does not apply when the preview fails, and passes its status on", async () => {
    runEnhanceMeetingNotes.mockRejectedValueOnce(new McpError("Too many requests. Try again shortly.", 429));
    const res = await enhance();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests. Try again shortly." });
    expect(runEnhanceMeetingNotes).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown action", async () => {
    expect((await enhance({ action: "delete" })).status).toBe(400);
    expect(runEnhanceMeetingNotes).not.toHaveBeenCalled();
  });
});
