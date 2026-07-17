export interface RetryOptions {
  // Backoff intervals in milliseconds. retry() runs the fn up to (backoffsMs.length + 1)
  // times — the initial call plus one retry per backoff.
  backoffsMs: number[];
  // If provided, retry only when this returns true for the thrown error.
  // Default: retry on every thrown error.
  shouldRetry?: (err: unknown) => boolean;
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= opts.backoffsMs.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      if (i === opts.backoffsMs.length) throw err;
      await new Promise((r) => setTimeout(r, opts.backoffsMs[i]!));
    }
  }
  throw lastErr;
}
