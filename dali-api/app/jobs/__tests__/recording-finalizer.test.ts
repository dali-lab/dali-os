import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/meeting-recording.server", () => ({
  RETRY_PENDING_MARKER: "__retry_pending__",
  applyResult: vi.fn(),
  finalizeEmpty: vi.fn(),
  startProcessing: vi.fn(),
}));
vi.mock("~/lib/transcription/chunks.server", () => ({ deletePrefix: vi.fn() }));

import { prisma } from "~/lib/db";
import { applyResult, finalizeEmpty, startProcessing } from "~/lib/meeting-recording.server";
import { deletePrefix } from "~/lib/transcription/chunks.server";
import { runRecordingFinalizer } from "~/jobs/recording-finalizer.server";

const mockPrisma = prisma as unknown as {
  meetingRecording: Record<string, ReturnType<typeof vi.fn>>;
};

const NOW = new Date("2026-10-09T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.meetingRecording.findMany.mockResolvedValue([]);
  mockPrisma.meetingRecording.update.mockResolvedValue({});
  mockPrisma.meetingRecording.delete.mockResolvedValue({});
});

describe("recording-finalizer", () => {
  it("(a) starts processing an abandoned row that has chunks", async () => {
    const rec = { id: "r1", status: "Recording", channels: ["mic"] };
    mockPrisma.meetingRecording.findMany
      .mockResolvedValueOnce([rec]) // abandoned
      .mockResolvedValueOnce([]) // stuck
      .mockResolvedValueOnce([]); // unclaimed

    const result = await runRecordingFinalizer({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(startProcessing).toHaveBeenCalledWith(rec);
    expect(finalizeEmpty).not.toHaveBeenCalled();
    expect(result.note).toContain("abandoned=1");
  });

  it("(a) finalizes an abandoned row with zero chunks as empty", async () => {
    const rec = { id: "r1", status: "Recording", channels: [] };
    mockPrisma.meetingRecording.findMany
      .mockResolvedValueOnce([rec])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await runRecordingFinalizer({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(finalizeEmpty).toHaveBeenCalledWith(rec);
    expect(startProcessing).not.toHaveBeenCalled();
  });

  it("(b) retries a Processing row stuck for the first time", async () => {
    const rec = { id: "r2", status: "Processing", error: null };
    mockPrisma.meetingRecording.findMany
      .mockResolvedValueOnce([]) // abandoned
      .mockResolvedValueOnce([rec]) // stuck
      .mockResolvedValueOnce([]); // unclaimed

    await runRecordingFinalizer({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "r2" },
      data: { error: "__retry_pending__" },
    });
    expect(startProcessing).toHaveBeenCalledWith(rec);
    expect(applyResult).not.toHaveBeenCalled();
  });

  it("(b) fails a Processing row already retried once (second timeout)", async () => {
    const rec = { id: "r3", status: "Processing", error: "__retry_pending__" };
    mockPrisma.meetingRecording.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([rec])
      .mockResolvedValueOnce([]);

    await runRecordingFinalizer({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(applyResult).toHaveBeenCalledWith(rec, {
      channels: {},
      error: "Transcription timed out.",
    });
    expect(startProcessing).not.toHaveBeenCalled();
  });

  it("(c) deletes a Pending row never claimed", async () => {
    const rec = { id: "r4", status: "Pending" };
    mockPrisma.meetingRecording.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([rec]);

    const result = await runRecordingFinalizer({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(deletePrefix).toHaveBeenCalledWith("r4");
    expect(mockPrisma.meetingRecording.delete).toHaveBeenCalledWith({ where: { id: "r4" } });
    expect(result.note).toContain("unclaimed=1");
  });

  it("is a no-op tick when nothing matches any branch", async () => {
    const result = await runRecordingFinalizer({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(result.items).toBe(0);
  });
});
