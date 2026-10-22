import { colors as C } from '../../theme';

export type TileShape = 'dot' | 'ring' | 'flower' | 'asterisk' | 'quarter' | 'half' | 'solid' | 'loose';

export interface Tile {
  shape: TileShape;
  background: string;
  foreground: string;
  rotation: number;
}

export const TILE_PAIRS = [
  { background: C.paleTeal, foreground: C.navy },
  { background: C.lightGreen, foreground: C.coral },
  { background: C.lightYellow, foreground: C.coral },
  { background: C.paleCoral, foreground: C.coolWhite },
  { background: C.green, foreground: C.lightYellow },
  { background: C.yellow, foreground: C.purple },
  { background: C.paleTeal, foreground: C.coral },
  { background: C.lightCoral, foreground: C.coolBlack },
  { background: C.paleCoral, foreground: C.navy },
  { background: C.lightGreen, foreground: C.teal },
  { background: C.teal, foreground: C.coolWhite },
  { background: C.navy, foreground: C.coolWhite },
  { background: C.coral, foreground: C.navy },
  { background: C.lightPurple, foreground: C.lightYellow },
  { background: C.purple, foreground: C.coolWhite },
  { background: C.yellow, foreground: C.coral },
];

const LOOSE_COLORS = [C.coral, C.green, C.lightPurple, C.teal, C.yellow, C.navy];
const DEFAULT_SHAPES: TileShape[] = ['dot', 'ring', 'flower', 'asterisk', 'quarter', 'solid', 'loose'];
const WEIGHTS: Record<TileShape, number> = { dot: 46, ring: 14, flower: 7, asterisk: 5, quarter: 9, half: 5, solid: 6, loose: 8 };

export function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 1831565813) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function looseTile(rand: () => number): Tile {
  return { shape: 'loose', background: 'transparent', foreground: LOOSE_COLORS[Math.floor(rand() * LOOSE_COLORS.length)], rotation: 0 };
}

export function generateTiles({
  rows,
  columns,
  seed,
  layout = 'cluster',
  density = 0.65,
  shapes = DEFAULT_SHAPES,
}: {
  rows: number;
  columns: number;
  seed: number;
  layout?: 'cluster' | 'grid';
  density?: number;
  shapes?: TileShape[];
}): (Tile | null)[] {
  const rand = seededRandom(seed);
  const pool = shapes.filter((s) => layout === 'cluster' || s !== 'loose');
  const total = pool.reduce((sum, s) => sum + WEIGHTS[s], 0);
  const clusters = Array.from({ length: 3 }, () => ({
    x: columns * (0.2 + rand() * 0.6),
    y: rows * (0.2 + rand() * 0.6),
    r: Math.max(rows, columns) * (0.35 + rand() * 0.25),
  }));
  const tiles: (Tile | null)[] = [];
  let lastPair = -1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      if (layout === 'cluster') {
        const closeness = Math.max(...clusters.map((c) => 1 - Math.hypot(col + 0.5 - c.x, row + 0.5 - c.y) / c.r));
        const chance = Math.min(1, Math.max(0, closeness) * 1.4) * density + 0.06;
        if (rand() > chance) {
          tiles.push(pool.includes('loose') && rand() < 0.07 ? looseTile(rand) : null);
          continue;
        }
      }
      let pick = rand() * total;
      let shape = pool[0];
      for (const s of pool) {
        pick -= WEIGHTS[s];
        if (pick <= 0) {
          shape = s;
          break;
        }
      }
      if (shape === 'loose') {
        tiles.push(looseTile(rand));
        continue;
      }
      let pair = Math.floor(rand() * TILE_PAIRS.length);
      if (pair === lastPair) pair = (pair + 1) % TILE_PAIRS.length;
      lastPair = pair;
      tiles.push({ shape, ...TILE_PAIRS[pair], rotation: Math.floor(rand() * 4) * 90 });
    }
  }
  return tiles;
}
