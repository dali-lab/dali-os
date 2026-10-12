// One upload queue per capture channel: at most one request in flight,
// retried with backoff, capped in memory so a stalled connection can't pile
// up unbounded audio. Network behavior is injected (`upload`) so this is
// unit-testable without a real fetch or AudioWorklet.

import type { ChunkResponse } from "./types";

/** Thrown by the injected `upload` fn for a 409 (recording already finalized
 *  or processing) — never retried, unlike a transient network failure. */
export class ChunkConflictError extends Error {}

export const MAX_QUEUED_CHUNKS = 20;
export const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 30_000];

export function backoffDelayMs(attempt: number): number {
  return BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)]!;
}

export type QueuedChunk = { segment: number; seq: number; buffer: ArrayBuffer };
export type UploadFn = (chunk: QueuedChunk) => Promise<ChunkResponse>;

export class ChunkUploadQueue {
  private queue: QueuedChunk[] = [];
  private uploading = false;
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly upload: UploadFn,
    private readonly callbacks: {
      onStalled?: () => void;
      onResponse?: (res: ChunkResponse) => void;
      onError?: (err: unknown) => void;
      onConflict?: () => void;
    } = {},
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  enqueue(chunk: QueuedChunk): void {
    if (this.stopped) return;
    this.queue.push(chunk);
    // Never drop the chunk currently uploading (queue[0] while `uploading`) —
    // its response/retry handling is keyed on that exact object.
    const minKeep = this.uploading ? 1 : 0;
    if (this.queue.length - minKeep > MAX_QUEUED_CHUNKS) {
      this.queue.splice(minKeep, 1);
      this.callbacks.onStalled?.();
    }
    this.pump();
  }

  private pump(): void {
    if (this.uploading || this.stopped || this.queue.length === 0) return;
    this.uploading = true;
    const chunk = this.queue[0]!;
    this.upload(chunk)
      .then((res) => {
        this.attempt = 0;
        this.queue.shift();
        this.uploading = false;
        this.callbacks.onResponse?.(res);
        this.pump();
      })
      .catch((err) => {
        this.uploading = false;
        if (err instanceof ChunkConflictError) {
          this.stopped = true;
          this.callbacks.onConflict?.();
          return;
        }
        this.callbacks.onError?.(err);
        const delay = backoffDelayMs(this.attempt++);
        this.timer = setTimeout(() => this.pump(), delay);
      });
  }

  /** Resolves once the queue drains, or after `timeoutMs`, whichever is first. */
  drain(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const isDrained = () => this.queue.length === 0 && !this.uploading;
      if (isDrained()) {
        resolve();
        return;
      }
      const poll = setInterval(() => {
        if (isDrained()) {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve();
        }
      }, 250);
      const timeout = setTimeout(() => {
        clearInterval(poll);
        resolve();
      }, timeoutMs);
    });
  }

  destroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }
}
