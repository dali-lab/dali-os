import { describe, expect, it, vi } from "vitest";
import { BACKOFF_SCHEDULE_MS, ChunkConflictError, ChunkUploadQueue, backoffDelayMs } from "./upload-queue";
import type { ChunkResponse } from "./types";

const okResponse: ChunkResponse = { stopRequested: false, behindSeconds: 0, lines: [] };

function chunk(seq: number): { segment: number; seq: number; buffer: ArrayBuffer } {
  return { segment: 0, seq, buffer: new ArrayBuffer(0) };
}

describe("backoffDelayMs", () => {
  it("follows the 1,2,4,8,30s schedule and caps at the last value", () => {
    expect(BACKOFF_SCHEDULE_MS).toEqual([1000, 2000, 4000, 8000, 30_000]);
    expect([0, 1, 2, 3, 4, 5, 99].map(backoffDelayMs)).toEqual([1000, 2000, 4000, 8000, 30_000, 30_000, 30_000]);
  });
});

describe("ChunkUploadQueue", () => {
  it("uploads chunks one at a time, in order", async () => {
    const seen: number[] = [];
    let resolveFirst!: (res: ChunkResponse) => void;
    const upload = vi
      .fn()
      .mockImplementationOnce((c) => {
        seen.push(c.seq);
        return new Promise<ChunkResponse>((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockImplementationOnce((c) => {
        seen.push(c.seq);
        return Promise.resolve(okResponse);
      });
    const q = new ChunkUploadQueue(upload);
    q.enqueue(chunk(0));
    q.enqueue(chunk(1));
    // Only the first chunk should have started — the second waits behind it.
    expect(seen).toEqual([0]);
    resolveFirst(okResponse);
    await vi.waitFor(() => expect(seen).toEqual([0, 1]));
  });

  it("drops the oldest queued chunk and reports stalled past the cap", async () => {
    const upload = vi.fn(() => new Promise<ChunkResponse>(() => {})); // never resolves
    const onStalled = vi.fn();
    const q = new ChunkUploadQueue(upload, { onStalled });
    for (let i = 0; i < 25; i++) q.enqueue(chunk(i));
    // 1 in flight + 20 queued = 21 kept; 4 oldest-after-the-in-flight dropped.
    expect(q.pending).toBe(21);
    expect(onStalled).toHaveBeenCalledTimes(4);
    // The in-flight chunk (seq 0) was never dropped, only ones behind it.
    expect(upload).toHaveBeenCalledWith(chunk(0));
  });

  it("retries on a transient failure and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    try {
      const upload = vi
        .fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce(okResponse);
      const onError = vi.fn();
      const onResponse = vi.fn();
      const q = new ChunkUploadQueue(upload, { onError, onResponse });
      q.enqueue(chunk(0));
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onResponse).toHaveBeenCalledWith(okResponse);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops and reports conflict on a 409 without retrying", async () => {
    const upload = vi.fn().mockRejectedValue(new ChunkConflictError("409"));
    const onConflict = vi.fn();
    const onError = vi.fn();
    const q = new ChunkUploadQueue(upload, { onConflict, onError });
    q.enqueue(chunk(0));
    await vi.waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
    q.enqueue(chunk(1));
    expect(upload).toHaveBeenCalledTimes(1); // the second enqueue never uploads
  });

  it("drain resolves once the queue empties", async () => {
    const upload = vi.fn().mockResolvedValue(okResponse);
    const q = new ChunkUploadQueue(upload);
    q.enqueue(chunk(0));
    await q.drain(1000);
    expect(q.pending).toBe(0);
  });

  it("drain resolves after the timeout even if work remains", async () => {
    const upload = vi.fn(() => new Promise<ChunkResponse>(() => {}));
    const q = new ChunkUploadQueue(upload);
    q.enqueue(chunk(0));
    const start = Date.now();
    await q.drain(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
