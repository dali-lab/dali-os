import { ApiError } from '../api/client';

export const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 30_000];

export type Chunk = { segment: number; seq: number; pcm: ArrayBuffer };
export type UploadFn = (chunk: Chunk) => Promise<{ stopRequested: boolean }>;

/** One chunk in flight at a time, retried with backoff until it lands. A 409 (the recording already ended) stops the queue. */
export class ChunkUploadQueue {
  private queue: Chunk[] = [];
  private uploading = false;
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly upload: UploadFn,
    private readonly callbacks: { onStopRequested?: () => void; onConflict?: () => void } = {},
  ) {}

  enqueue(chunk: Chunk): void {
    if (this.stopped) return;
    this.queue.push(chunk);
    this.pump();
  }

  private pump(): void {
    if (this.uploading || this.stopped || this.queue.length === 0) return;
    this.uploading = true;
    const chunk = this.queue[0];
    this.upload(chunk)
      .then((res) => {
        this.attempt = 0;
        this.queue.shift();
        this.uploading = false;
        if (res.stopRequested) this.callbacks.onStopRequested?.();
        this.pump();
      })
      .catch((err) => {
        this.uploading = false;
        if (err instanceof ApiError && err.status === 409) {
          this.stopped = true;
          this.callbacks.onConflict?.();
          return;
        }
        const delay = BACKOFF_SCHEDULE_MS[Math.min(this.attempt++, BACKOFF_SCHEDULE_MS.length - 1)];
        this.timer = setTimeout(() => this.pump(), delay);
      });
  }

  /** Resolves once every queued chunk has uploaded, or after `timeoutMs`. */
  drain(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (this.queue.length === 0 && !this.uploading) return resolve(true);
        if (this.stopped || Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(check, 250);
      };
      check();
    });
  }

  destroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }
}
