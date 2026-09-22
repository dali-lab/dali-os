import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  appendLines,
  cleanLines,
  finishRecording,
  ownRecording,
  recordingDeepLink,
  requestStop,
} from "~/lib/meeting-recording.server";

const rec = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    pageId: "p1",
    userId: "u1",
    status: "Recording",
    stopRequested: false,
    systemAudio: true,
    lines: [{ at: 1, text: "hi", source: "you" }],
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
    const res = await appendLines(rec({ stopRequested: true }), [], true);
    expect(res).toEqual({ stopRequested: true });
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
    await finishRecording(rec(), "Mic blocked");
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Failed", error: "Mic blocked" } }),
    );
  });
});
