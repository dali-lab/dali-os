import { AUTH_TILES, type AuthTileMotif } from "~/components/auth/auth-tiles";

export type StripTile = { bg: string; fg: string; motif: AuthTileMotif };
export type StripCell = StripTile | null;

export const STRIP_COLUMNS = 12;
export const STRIP_ROWS = 2;

const uniquePairs = (tiles: StripTile[]) => [
  ...new Map(tiles.map((t) => [`${t.bg}|${t.fg}|${t.motif}`, t])).values(),
];
const toTile = ({ bg, fg, motif }: StripTile): StripTile => ({ bg, fg, motif });

export const SOLID_TILES = uniquePairs(AUTH_TILES.filter((t) => t.bg !== "transparent").map(toTile));
export const LOOSE_TILES = uniquePairs(AUTH_TILES.filter((t) => t.bg === "transparent").map(toTile));

// Today's look: a sparse top row over a nearly full bottom row. Each count may
// drift by one per form.
export const ROW_SHAPE = [
  { solid: 3, loose: 2 },
  { solid: 10, loose: 0 },
] as const;

export const isLightCell = (cell: StripCell) => !cell || cell.motif === "loose";

export const cellIndex = (col: number, row: number) => row * STRIP_COLUMNS + col;

function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pick = <T>(items: readonly T[], rand: () => number) => items[Math.floor(rand() * items.length)];

function drawPattern(rand: () => number): StripCell[] {
  const cells: StripCell[] = Array(STRIP_COLUMNS * STRIP_ROWS).fill(null);
  ROW_SHAPE.forEach((shape, row) => {
    const solid = shape.solid + Math.floor(rand() * 3) - 1;
    const kinds = Array.from({ length: STRIP_COLUMNS }, (_, i) =>
      i < solid ? "solid" : i < solid + shape.loose ? "loose" : "empty",
    );
    shuffle(kinds, rand).forEach((kind, col) => {
      if (kind === "loose") cells[cellIndex(col, row)] = pick(LOOSE_TILES, rand);
      if (kind !== "solid") return;
      const left = col > 0 ? cells[cellIndex(col - 1, row)] : null;
      const above = row > 0 ? cells[cellIndex(col, row - 1)] : null;
      const options = SOLID_TILES.filter((t) => t.bg !== left?.bg && t.bg !== above?.bg);
      cells[cellIndex(col, row)] = pick(options, rand);
    });
  });
  return cells;
}

export type FoldHinge = "left" | "bottom" | "top";
export type FoldStep = { kind: "strip" | "square"; hinge: FoldHinge; moves: [from: number, to: number][] };

// The strip folds in from the right, two columns per step, each pair mirrored
// onto its neighbour; the remaining 2x2 then folds clockwise onto its top-left.
export const FOLD_STEPS: FoldStep[] = [
  ...[5, 4, 3, 2, 1].map((group): FoldStep => ({
    kind: "strip",
    hinge: "left",
    moves: [0, 1].flatMap((row): [number, number][] => [
      [cellIndex(2 * group, row), cellIndex(2 * group - 1, row)],
      [cellIndex(2 * group + 1, row), cellIndex(2 * group - 2, row)],
    ]),
  })),
  { kind: "square", hinge: "bottom", moves: [[cellIndex(1, 0), cellIndex(1, 1)]] },
  { kind: "square", hinge: "left", moves: [[cellIndex(1, 1), cellIndex(0, 1)]] },
  { kind: "square", hinge: "top", moves: [[cellIndex(0, 1), cellIndex(0, 0)]] },
];

// A folded tile covers what it lands on, except a white dot never hides a
// coloured tile.
const land = (target: StripCell, source: StripCell): StripCell =>
  source && (!isLightCell(source) || isLightCell(target)) ? source : target;

export function foldFrames(cells: StripCell[]): StripCell[][] {
  const frames = [cells];
  for (const step of FOLD_STEPS) {
    const prev = frames[frames.length - 1];
    const next = [...prev];
    for (const [from, to] of step.moves) {
      next[to] = land(prev[to], prev[from]);
      next[from] = null;
    }
    frames.push(next);
  }
  return frames;
}

export const foldedTile = (cells: StripCell[]) => foldFrames(cells)[FOLD_STEPS.length][0];

const MAX_DRAWS = 50;

export function stripPattern(seed: string): StripCell[] {
  const rand = mulberry32(hashSeed(seed));
  let cells = drawPattern(rand);
  for (let i = 1; i < MAX_DRAWS && isLightCell(foldedTile(cells)); i++) cells = drawPattern(rand);
  return cells;
}
