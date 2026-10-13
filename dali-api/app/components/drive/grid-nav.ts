/** A run of tiles that wrap together (the folder band, a file grid, the drives). */
export type GridBlock = { count: number; perRow: number };

/** How many tiles sit on the first visual row, from each tile's top offset in layout order. */
export function perRowFromTops(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  let n = 1;
  while (n < tops.length && tops[n] === tops[0]) n++;
  return n;
}

/**
 * The tile one visual row below (`dir` 1) or above (-1) `index` in a grid that
 * wraps every `perRow` tiles. Stepping down from a row above a shorter last row
 * lands on its last tile, as in Finder; at the first or last row it stays put.
 */
export function gridStep(count: number, perRow: number, index: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  const cols = Math.max(1, perRow);
  const next = index + dir * cols;
  if (next < 0) return index;
  if (next < count) return next;
  const lastRowStart = Math.floor((count - 1) / cols) * cols;
  return index >= lastRowStart ? index : count - 1;
}

/**
 * `gridStep` across consecutive blocks laid out one after another (the folder
 * band above the file grid): leaving a block's edge moves into the neighbouring
 * block's nearest row, keeping the column where it can.
 */
export function gridStepBlocks(blocks: readonly GridBlock[], index: number, dir: 1 | -1): number {
  const starts = blocks.map((_, k) => blocks.slice(0, k).reduce((n, b) => n + b.count, 0));
  const total = blocks.reduce((n, b) => n + b.count, 0);
  if (total === 0) return -1;
  if (index < 0) return 0;
  const i = blocks.findIndex((b, k) => index < starts[k] + b.count);
  if (i === -1) return index;

  const { count, perRow } = blocks[i];
  const local = index - starts[i];
  const next = gridStep(count, perRow, local, dir);
  if (next !== local) return starts[i] + next;

  const candidates = blocks.map((b, k) => k).filter((k) => blocks[k].count > 0 && (dir === 1 ? k > i : k < i));
  const j = dir === 1 ? candidates[0] : candidates[candidates.length - 1];
  if (j === undefined) return index;
  const cols = Math.max(1, blocks[j].perRow);
  const rowStart = dir === 1 ? 0 : Math.floor((blocks[j].count - 1) / cols) * cols;
  const col = local % Math.max(1, perRow);
  return starts[j] + rowStart + Math.min(col, cols - 1, blocks[j].count - 1 - rowStart);
}
