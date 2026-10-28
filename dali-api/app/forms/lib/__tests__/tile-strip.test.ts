import { describe, expect, it } from "vitest";
import {
  FOLD_STEPS,
  LOOSE_TILES,
  ROW_SHAPE,
  SOLID_TILES,
  STRIP_COLUMNS,
  STRIP_ROWS,
  cellIndex,
  foldFrames,
  foldedTile,
  isLightCell,
  stripPattern,
  type StripCell,
} from "~/forms/lib/tile-strip";

const SEEDS = Array.from({ length: 2000 }, (_, i) => `form_${i.toString(36)}_${(i * 7919) % 104729}`);

const row = (cells: StripCell[], r: number) => cells.slice(r * STRIP_COLUMNS, (r + 1) * STRIP_COLUMNS);
const solidCount = (cells: StripCell[]) => cells.filter((c) => c && c.motif !== "loose").length;
const looseCount = (cells: StripCell[]) => cells.filter((c) => c?.motif === "loose").length;

describe("stripPattern", () => {
  it("returns the same pattern for the same form every time", () => {
    expect(stripPattern("cm_form_rsvp")).toEqual(stripPattern("cm_form_rsvp"));
  });

  it("gives different forms different patterns", () => {
    const distinct = new Set(SEEDS.slice(0, 200).map((s) => JSON.stringify(stripPattern(s))));
    expect(distinct.size).toBe(200);
  });

  it("is a 12 by 2 strip", () => {
    for (const seed of SEEDS.slice(0, 50)) expect(stripPattern(seed)).toHaveLength(STRIP_COLUMNS * STRIP_ROWS);
  });

  it("keeps each row's coloured tiles within one of today's count", () => {
    for (const seed of SEEDS) {
      const cells = stripPattern(seed);
      ROW_SHAPE.forEach((shape, r) => {
        const solid = solidCount(row(cells, r));
        expect(solid).toBeGreaterThanOrEqual(shape.solid - 1);
        expect(solid).toBeLessThanOrEqual(shape.solid + 1);
        expect(looseCount(row(cells, r))).toBe(shape.loose);
      });
    }
  });

  it("uses every count in the allowed range across forms", () => {
    const topCounts = new Set(SEEDS.map((s) => solidCount(row(stripPattern(s), 0))));
    const bottomCounts = new Set(SEEDS.map((s) => solidCount(row(stripPattern(s), 1))));
    expect([...topCounts].sort()).toEqual([2, 3, 4]);
    expect([...bottomCounts].sort((a, b) => a - b)).toEqual([9, 10, 11]);
  });

  it("never puts two tiles of the same colour side by side or stacked", () => {
    for (const seed of SEEDS) {
      const cells = stripPattern(seed);
      for (let r = 0; r < STRIP_ROWS; r++) {
        for (let c = 0; c < STRIP_COLUMNS; c++) {
          const cell = cells[cellIndex(c, r)];
          if (!cell || cell.motif === "loose") continue;
          if (c > 0) expect(cells[cellIndex(c - 1, r)]?.bg).not.toBe(cell.bg);
          if (r > 0) expect(cells[cellIndex(c, r - 1)]?.bg).not.toBe(cell.bg);
        }
      }
    }
  });

  it("draws only from the login page's tile pairs", () => {
    const known = new Set([...SOLID_TILES, ...LOOSE_TILES].map((t) => `${t.bg}|${t.fg}|${t.motif}`));
    for (const seed of SEEDS.slice(0, 200)) {
      for (const cell of stripPattern(seed)) if (cell) expect(known.has(`${cell.bg}|${cell.fg}|${cell.motif}`)).toBe(true);
    }
  });

  it("always folds down to a coloured tile, never a white dot or a gap", () => {
    for (const seed of SEEDS) expect(isLightCell(foldedTile(stripPattern(seed)))).toBe(false);
  });
});

describe("foldFrames", () => {
  const cells = stripPattern("cm_form_rsvp");
  const frames = foldFrames(cells);

  it("starts from the pattern and has one frame per fold after it", () => {
    expect(frames[0]).toBe(cells);
    expect(frames).toHaveLength(FOLD_STEPS.length + 1);
  });

  it("ends with a single tile in the top-left corner", () => {
    const last = frames[FOLD_STEPS.length];
    expect(last[0]).not.toBeNull();
    expect(last.slice(1).every((c) => c === null)).toBe(true);
  });

  it("folds the strip right to left two columns at a time, then the square clockwise", () => {
    expect(FOLD_STEPS.map((s) => `${s.kind}:${s.hinge}`)).toEqual([
      ...Array(5).fill("strip:left"),
      "square:bottom",
      "square:left",
      "square:top",
    ]);
    const occupiedColumns = (frame: StripCell[]) =>
      Math.max(...frame.map((c, i) => (c ? i % STRIP_COLUMNS : -1))) + 1;
    expect(occupiedColumns(frames[5])).toBeLessThanOrEqual(2);
  });

  it("lands a folded tile on top of what it covers", () => {
    const tile = SOLID_TILES[0];
    const other = SOLID_TILES[1];
    const strip: StripCell[] = Array(24).fill(null);
    strip[cellIndex(11, 0)] = tile;
    strip[cellIndex(0, 0)] = other;
    const after = foldFrames(strip)[1];
    expect(after[cellIndex(8, 0)]).toBe(tile);
    expect(after[cellIndex(11, 0)]).toBeNull();
  });

  it("does not let a white dot cover a coloured tile", () => {
    const strip: StripCell[] = Array(24).fill(null);
    strip[cellIndex(11, 0)] = LOOSE_TILES[0];
    strip[cellIndex(8, 0)] = SOLID_TILES[0];
    expect(foldFrames(strip)[1][cellIndex(8, 0)]).toBe(SOLID_TILES[0]);
  });

  it("keeps what is underneath when a gap folds over it", () => {
    const strip: StripCell[] = Array(24).fill(null);
    strip[cellIndex(9, 1)] = SOLID_TILES[2];
    expect(foldFrames(strip)[1][cellIndex(9, 1)]).toBe(SOLID_TILES[2]);
  });
});
