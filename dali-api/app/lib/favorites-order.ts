/** Move the item with `id` by `delta` slots, clamped to the list. Returns the same array when nothing moves. */
export function moveById<T extends { id: string }>(list: T[], id: string, delta: number): T[] {
  const from = list.findIndex((x) => x.id === id);
  if (from === -1) return list;
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
