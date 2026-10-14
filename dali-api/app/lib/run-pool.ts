/** Runs `worker` over `items` with at most `limit` in flight; the worker owns its own error handling. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function lane() {
    while (next < items.length) await worker(items[next++]);
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
