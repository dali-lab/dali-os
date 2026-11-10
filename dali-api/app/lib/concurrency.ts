/** Runs `fn` over `items` with at most `limit` running at once. Rejects on the first failure. */
export async function forEachWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items[Symbol.iterator]();
  const worker = async () => {
    for (const item of queue) await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
