import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/collabAuth", () => ({ authorizeCollabDoc: vi.fn() }));

import { prisma } from "~/lib/db";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import {
  appendLines,
  canRecordInto,
  cleanLines,
  finishRecording,
  ownRecording,
  recordingDeepLink,
  requestStop,
  resumeRecording,
} from "~/lib/meeting-recording.server";

const rec = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    documentName: "doc:p1:body",
    userId: "u1",
    status: "Recording",
    stopRequested: false,
    systemAudio: true,
    lines: [{ at: 1, text: "hi", source: "you" }],
    recordedSeconds: 0,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.meetingRecording.update).mockResolvedValue({ stopRequested: false } as never);
});

describe("recordingDeepLink", () => {
  it("points the desktop app at the recording", () => {
    expect(recordingDeepLink("abc123")).toBe("dalios://record?id=abc123");
  });
});

describe("canRecordInto", () => {
  it("allows a room the user can write to", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
    expect(await canRecordInto("u1", "interview:i1:notes")).toBe(true);
  });

  it("refuses a read-only viewer", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: true });
    expect(await canRecordInto("u1", "doc:p1:body")).toBe(false);
  });

  it("never records into a presence room", async () => {
    expect(await canRecordInto("u1", "presence:p1")).toBe(false);
    expect(authorizeCollabDoc).not.toHaveBeenCalled();
  });
});

describe("ownRecording", () => {
  it("hides someone else's recording", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(rec({ userId: "u2" }));
    expect(await ownRecording("r1", "u1")).toBeNull();
  });
});

describe("cleanLines", () => {
  it("keeps well-formed lines and drops the rest", () => {
    expect(
      cleanLines([
        { at: 2, text: "  hello ", source: "others" },
        { at: -1, text: "negative" },
        { at: 3, text: "   " },
        { at: 4, text: "no source", source: "robot" },
        "junk",
      ]),
    ).toEqual([
      { at: 2, text: "hello", source: "others" },
      { at: 4, text: "no source" },
    ]);
  });

  it("ignores a non-array", () => {
    expect(cleanLines({ at: 1 })).toEqual([]);
  });
});

describe("appendLines", () => {
  it("adds lines and marks a pending recording as started", async () => {
    await appendLines(rec({ status: "Pending" }), [{ at: 2, text: "yo" }], false);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          lines: [
            { at: 1, text: "hi", source: "you" },
            { at: 2, text: "yo" },
          ],
          status: "Recording",
          systemAudio: false,
        },
      }),
    );
  });

  it("answers an empty heartbeat without writing", async () => {
    const res = await appendLines(rec({ stopRequested: true, recordedSeconds: 90 }), [], true);
    expect(res).toEqual({ stopRequested: true, offset: 90 });
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });
});

describe("requestStop", () => {
  it("ends a recording the app never picked up", async () => {
    await requestStop(rec({ status: "Pending" }));
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Stopped", stopRequested: true } }),
    );
  });

  it("only flags a live recording, so the app flushes before it stops", async () => {
    await requestStop(rec());
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stopRequested: true } }),
    );
  });
});

describe("finishRecording", () => {
  it("records why the app failed", async () => {
    await finishRecording(rec(), "Mic blocked", 12);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "Failed", error: "Mic blocked", recordedSeconds: { increment: 12 } },
      }),
    );
  });

  it("adds the session's length so Continue picks up after it", async () => {
    await finishRecording(rec(), null, 61.5);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Stopped", recordedSeconds: { increment: 61.5 } } }),
    );
  });
});

describe("resumeRecording", () => {
  it("re-arms a stopped recording for the app", async () => {
    expect(await resumeRecording(rec({ status: "Stopped", stopRequested: true }))).toBe(true);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Pending", stopRequested: false, error: null } }),
    );
  });

  it("refuses while the app is still recording", async () => {
    expect(await resumeRecording(rec({ status: "Recording" }))).toBe(false);
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });
});
