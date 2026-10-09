import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/collabAuth", () => ({ authorizeCollabDoc: vi.fn() }));
vi.mock("~/lib/transcription/chunks.server", () => ({ deletePrefix: vi.fn() }));
vi.mock("~/lib/transcription/provider", () => ({ getTranscriptionProvider: vi.fn() }));

import { prisma } from "~/lib/db";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { deletePrefix } from "~/lib/transcription/chunks.server";
import { getTranscriptionProvider } from "~/lib/transcription/provider";
import {
  MAX_ACTIVE_RECORDINGS,
  RETRY_PENDING_MARKER,
  applyResult,
  canReadRecording,
  canRecordInto,
  claimRecording,
  createRecording,
  finalizeEmpty,
  finishRecording,
  formatRecordingTranscript,
  ownRecording,
  parseSpeakerMap,
  recordChunk,
  recordingDeepLink,
  requestStop,
  resumeRecording,
  setSpeakers,
  startProcessing,
} from "~/lib/meeting-recording.server";

const rec = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    documentName: "doc:p1:body",
    userId: "u1",
    status: "Recording",
    stopRequested: false,
    scheduledMeetingId: null,
    occurrenceStart: null,
    channels: ["mic"],
    segmentStarts: [0],
    chunkIndex: {},
    lastChunkAt: null,
    words: {},
    lines: [{ at: 1, text: "hi", source: "you" }],
    speakers: {},
    recordedSeconds: 0,
    error: null,
    insertedAt: null,
    finalizedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.meetingRecording.update).mockResolvedValue({ stopRequested: false } as never);
  vi.mocked(prisma.meetingRecording.findMany).mockResolvedValue([]);
  vi.mocked(prisma.meetingRecording.count).mockResolvedValue(0);
  vi.mocked(prisma.meetingRecording.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.meetingRecording.create).mockResolvedValue(rec());
  vi.mocked(deletePrefix).mockResolvedValue(undefined);
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

describe("canReadRecording", () => {
  it("is the owner", async () => {
    expect(await canReadRecording(rec({ userId: "u1" }), "u1")).toBe("owner");
    expect(authorizeCollabDoc).not.toHaveBeenCalled();
  });

  it("is a viewer when they can see the note", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: true });
    expect(await canReadRecording(rec({ userId: "u2" }), "u1")).toBe("viewer");
  });

  it("is neither when the note is closed to them", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });
    expect(await canReadRecording(rec({ userId: "u2" }), "u1")).toBeNull();
  });
});

describe("ownRecording", () => {
  it("hides someone else's recording", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(rec({ userId: "u2" }));
    expect(await ownRecording("r1", "u1")).toBeNull();
  });
});

describe("createRecording", () => {
  it("sweeps a user's stale, never-finalized rows and their S3 prefixes", async () => {
    vi.mocked(prisma.meetingRecording.findMany).mockResolvedValue([{ id: "old1" }, { id: "old2" }] as never);

    await createRecording("u1", "doc:p1:body");

    expect(prisma.meetingRecording.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u1", finalizedAt: null }) }),
    );
    expect(deletePrefix).toHaveBeenCalledWith("old1");
    expect(deletePrefix).toHaveBeenCalledWith("old2");
    expect(prisma.meetingRecording.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old1", "old2"] } },
    });
  });

  it("seeds segment 0 and carries the meeting link", async () => {
    const start = new Date("2026-10-09T15:00:00Z");
    await createRecording("u1", "doc:p1:body", { scheduledMeetingId: "m1", occurrenceStart: start });

    expect(prisma.meetingRecording.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        documentName: "doc:p1:body",
        segmentStarts: [0],
        scheduledMeetingId: "m1",
        occurrenceStart: start,
      },
    });
  });

  it("refuses at the lab-wide active-recording cap", async () => {
    vi.mocked(prisma.meetingRecording.count).mockResolvedValue(MAX_ACTIVE_RECORDINGS);
    expect(await createRecording("u1", "doc:p1:body")).toBeNull();
    expect(prisma.meetingRecording.create).not.toHaveBeenCalled();
  });
});

describe("claimRecording", () => {
  it("claims a Pending recording and flips it to Recording", async () => {
    const result = await claimRecording(rec({ status: "Pending", segmentStarts: [0] }));
    expect(result).toEqual({ ok: true, offset: 0, segment: 0 });
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Recording" } }),
    );
  });

  it("re-claims a Recording session without changing status", async () => {
    const result = await claimRecording(rec({ status: "Recording", segmentStarts: [0, 42] }));
    expect(result).toEqual({ ok: true, offset: 42, segment: 1 });
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("refuses once the recording isn't live anymore", async () => {
    expect(await claimRecording(rec({ status: "Stopped" }))).toEqual({ ok: false });
  });
});

describe("recordChunk", () => {
  it("adds the channel, bumps the high-water seq, and starts a Pending row", async () => {
    vi.mocked(prisma.meetingRecording.update).mockResolvedValue({ stopRequested: true } as never);

    const result = await recordChunk(
      rec({ status: "Pending", channels: [], chunkIndex: { mic: [2] } }),
      "mic",
      0,
      5,
    );

    expect(result).toEqual({ stopRequested: true });
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channels: ["mic"],
          chunkIndex: { mic: [5] },
          status: "Recording",
        }),
      }),
    );
  });

  it("never lowers the high-water seq on an out-of-order retry", async () => {
    await recordChunk(rec({ chunkIndex: { mic: [10] } }), "mic", 0, 3);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ chunkIndex: { mic: [10] } }) }),
    );
  });
});

describe("requestStop", () => {
  it("ends a recording the client never claimed", async () => {
    await requestStop(rec({ status: "Pending" }));
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Stopped", stopRequested: true } }),
    );
  });

  it("only flags a live recording, so the client flushes before it stops", async () => {
    await requestStop(rec());
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stopRequested: true } }),
    );
  });
});

describe("resumeRecording", () => {
  it("re-arms a stopped, not-yet-finalized recording", async () => {
    expect(await resumeRecording(rec({ status: "Stopped", finalizedAt: null, recordedSeconds: 90 }))).toBe(
      true,
    );
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { segmentStarts: { push: 90 }, status: "Pending", stopRequested: false, error: null },
      }),
    );
  });

  it("refuses a finalized (zero-chunk) stop", async () => {
    expect(await resumeRecording(rec({ status: "Stopped", finalizedAt: new Date() }))).toBe(false);
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("refuses once processing has started", async () => {
    expect(await resumeRecording(rec({ status: "Processing" }))).toBe(false);
  });
});

describe("finishRecording", () => {
  it("records why the client failed", async () => {
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

describe("parseSpeakerMap", () => {
  it("accepts well-formed keys and values", () => {
    expect(parseSpeakerMap({ "mic:1": "Alex", "call:2": "u2" })).toEqual({ "mic:1": "Alex", "call:2": "u2" });
  });

  it("rejects a malformed key", () => {
    expect(parseSpeakerMap({ "mic1": "Alex" })).toBeNull();
  });

  it("rejects an empty or too-long value", () => {
    expect(parseSpeakerMap({ "mic:1": "" })).toBeNull();
    expect(parseSpeakerMap({ "mic:1": "x".repeat(81) })).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(parseSpeakerMap(["mic:1"])).toBeNull();
    expect(parseSpeakerMap(null)).toBeNull();
  });
});

describe("setSpeakers", () => {
  it("merges into the existing map rather than replacing it", async () => {
    await setSpeakers(rec({ speakers: { "mic:1": "Alex" } }), { "call:1": "u2" });
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { speakers: { "mic:1": "Alex", "call:1": "u2" } },
    });
  });
});

describe("startProcessing / finalizeEmpty", () => {
  it("dispatches to the provider and leaves the row Processing", async () => {
    const process = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getTranscriptionProvider).mockReturnValue({ process });

    await startProcessing(rec({ channels: ["mic"], segmentStarts: [0], chunkIndex: { mic: [1] } }));

    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Processing" } }),
    );
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "r1",
        channels: [{ channel: "mic", segments: [{ segment: 0, startSeconds: 0, seqCount: 2 }] }],
      }),
    );
  });

  it("fails immediately when no provider is configured", async () => {
    vi.mocked(getTranscriptionProvider).mockReturnValue(null);
    await startProcessing(rec());
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "Failed", error: "Transcription is not configured." }),
      }),
    );
    expect(deletePrefix).toHaveBeenCalledWith("r1");
  });

  it("fails when dispatch throws", async () => {
    vi.mocked(getTranscriptionProvider).mockReturnValue({
      process: vi.fn().mockRejectedValue(new Error("network down")),
    });
    await startProcessing(rec());
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Failed", error: "network down" }) }),
    );
  });

  it("finalizeEmpty closes a zero-chunk stop as not resumable", async () => {
    await finalizeEmpty(rec());
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Stopped" }) }),
    );
    expect(deletePrefix).toHaveBeenCalledWith("r1");
  });
});

describe("applyResult", () => {
  const success = {
    channels: {
      mic: {
        words: [
          { s: 0, e: 0.3, w: "hi" },
          { s: 0.4, e: 0.6, w: "there" },
        ],
        segments: [{ s: 0, e: 1, speaker: 1 }],
      },
    },
    error: null,
  };

  it("builds words and lines and marks the row Done", async () => {
    await applyResult(rec({ status: "Processing" }), success);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "Done", error: null, finalizedAt: expect.any(Date) }),
      }),
    );
    expect(deletePrefix).toHaveBeenCalledWith("r1");
  });

  it("is idempotent once Done", async () => {
    await applyResult(rec({ status: "Done" }), success);
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
    expect(deletePrefix).not.toHaveBeenCalled();
  });

  it("sets Failed on an error callback", async () => {
    await applyResult(rec({ status: "Processing" }), { channels: {}, error: "ASR crashed" });
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Failed", error: "ASR crashed" }) }),
    );
  });

  it("a late success after the finalizer marked it Failed still sets Done", async () => {
    await applyResult(rec({ status: "Failed", error: RETRY_PENDING_MARKER }), success);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Done" }) }),
    );
  });
});

describe("formatRecordingTranscript", () => {
  it("labels an unrenamed single mic speaker as You", async () => {
    const text = await formatRecordingTranscript(
      rec({
        lines: [{ at: 1, end: 2, text: "hi", channel: "mic", speaker: "mic:1" }],
        speakers: {},
      }),
    );
    expect(text).toBe("[00:01] You: hi");
  });

  it("resolves a renamed speaker through a user lookup", async () => {
    const userId = "c" + "x".repeat(24); // cuid-shaped, matches the userId heuristic
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: userId, firstName: "Alex", lastName: "Kim" },
    ] as never);
    const text = await formatRecordingTranscript(
      rec({
        lines: [{ at: 1, end: 2, text: "hi", channel: "call", speaker: "call:1" }],
        speakers: { "call:1": userId },
      }),
    );
    expect(text).toBe("[00:01] Alex Kim: hi");
  });

  it("falls back to Speaker N for a second diarized voice on a channel", async () => {
    const text = await formatRecordingTranscript(
      rec({
        lines: [
          { at: 1, end: 2, text: "hi", channel: "mic", speaker: "mic:1" },
          { at: 3, end: 4, text: "yo", channel: "mic", speaker: "mic:2" },
        ],
        speakers: {},
      }),
    );
    expect(text).toBe("[00:01] Speaker 1: hi\n[00:03] Speaker 2: yo");
  });
});
