import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});
vi.mock("~/lib/db");
vi.mock("~/lib/display", () => ({
  fullName: (u: { firstName: string; lastName: string }) =>
    `${u.firstName} ${u.lastName}`.trim(),
}));
vi.mock("~/lib/meeting-recording.server", () => ({
  canReadRecording: vi.fn(),
  storedLines: (rec: { lines: unknown }) => (Array.isArray(rec.lines) ? rec.lines : []),
}));

import { prisma } from "~/lib/db";
import { canReadRecording } from "~/lib/meeting-recording.server";
import {
  runGetMeetingTranscript,
  GET_MEETING_TRANSCRIPT_DEF,
} from "~/mcp/tools/calendar-extra/get-meeting-transcript";

const mockPrisma = prisma as unknown as {
  meetingRecording: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  meetingAttendance: { findMany: ReturnType<typeof vi.fn> };
};
const mockCanReadRecording = canReadRecording as unknown as ReturnType<typeof vi.fn>;

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec1",
    status: "Done",
    recordedSeconds: 120,
    lines: [],
    speakers: {},
    userId: "u-owner",
    documentName: "doc:page1:body",
    scheduledMeetingId: "m1",
    occurrenceStart: new Date("2026-09-15T14:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.meetingAttendance.findMany.mockResolvedValue([]);
  mockCanReadRecording.mockResolvedValue("owner");
});

describe("get_meeting_transcript", () => {
  it("requires mcp:read scope", () => {
    expect(GET_MEETING_TRANSCRIPT_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpInvalidError when neither recordingId nor meetingId is given", async () => {
    await expect(runGetMeetingTranscript("u1", {})).rejects.toMatchObject({
      name: "McpInvalidError",
    });
  });

  it("throws McpNotFoundError when the recording doesn't exist", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(null);
    await expect(
      runGetMeetingTranscript("u1", { recordingId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpNotFoundError (not Forbidden) when the caller can't read the recording", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording());
    mockCanReadRecording.mockResolvedValue(null);
    await expect(
      runGetMeetingTranscript("u-stranger", { recordingId: "rec1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("resolves speaker labels the same way the UI does", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(
      recording({
        speakers: { "mic:1": "u2" },
        lines: [
          { at: 0, end: 5, text: "hi there", channel: "mic", speaker: "mic:1" },
          { at: 5, end: 10, text: "hey", channel: "call" },
          { at: 10, end: 15, text: "go ahead", channel: "mic", speaker: "mic:2" },
        ],
      }),
    );
    mockPrisma.meetingAttendance.findMany.mockResolvedValue([
      { userId: "u2", user: { firstName: "Bob", lastName: "Jones", daliEmail: null } },
    ]);

    const out = await runGetMeetingTranscript("u-owner", { recordingId: "rec1" });

    expect(out.recordingId).toBe("rec1");
    expect(out.status).toBe("Done");
    expect(out.recordedSeconds).toBe(120);
    expect(out.speakers).toEqual([
      { key: "mic:1", label: "Bob Jones" },
      { key: "call", label: "Others" },
      { key: "mic:2", label: "Speaker 2" },
    ]);
    expect(out.lines).toEqual([
      { at: 0, end: 5, speaker: "mic:1", text: "hi there" },
      { at: 5, end: 10, speaker: "call", text: "hey" },
      { at: 10, end: 15, speaker: "mic:2", text: "go ahead" },
    ]);
    expect(out.nextCursor).toBeNull();
  });

  it("pages lines at 2000 per call", async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => ({
      at: i,
      end: i + 1,
      text: `line ${i}`,
      channel: "mic" as const,
    }));
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ lines }));

    const page1 = await runGetMeetingTranscript("u-owner", { recordingId: "rec1" });
    expect(page1.lines).toHaveLength(2000);
    expect(page1.lines[0].at).toBe(0);
    expect(page1.nextCursor).toBe(2000);

    const page2 = await runGetMeetingTranscript("u-owner", { recordingId: "rec1", cursor: 2000 });
    expect(page2.lines).toHaveLength(500);
    expect(page2.lines[0].at).toBe(2000);
    expect(page2.nextCursor).toBeNull();
  });

  it("filters lines by from/to seconds", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(
      recording({
        lines: [
          { at: 0, end: 5, text: "a", channel: "mic" },
          { at: 10, end: 15, text: "b", channel: "mic" },
          { at: 20, end: 25, text: "c", channel: "mic" },
          { at: 30, end: 35, text: "d", channel: "mic" },
        ],
      }),
    );

    const out = await runGetMeetingTranscript("u-owner", { recordingId: "rec1", from: 10, to: 20 });
    expect(out.lines.map((l) => l.text)).toEqual(["b", "c"]);
  });

  it("picks the newest Done recording for a meeting + occurrence", async () => {
    mockPrisma.meetingRecording.findFirst.mockResolvedValue(recording());
    await runGetMeetingTranscript("u-owner", {
      meetingId: "m1",
      occurrenceStart: "2026-09-15T14:00:00.000Z",
    });
    expect(mockPrisma.meetingRecording.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduledMeetingId: "m1",
          status: "Done",
          occurrenceStart: new Date("2026-09-15T14:00:00.000Z"),
        }),
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("picks the meeting's newest Done recording across occurrences when occurrenceStart is omitted", async () => {
    mockPrisma.meetingRecording.findFirst.mockResolvedValue(recording());
    await runGetMeetingTranscript("u-owner", { meetingId: "m1" });
    expect(mockPrisma.meetingRecording.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scheduledMeetingId: "m1", status: "Done" }),
        orderBy: { occurrenceStart: "desc" },
      }),
    );
  });
});
