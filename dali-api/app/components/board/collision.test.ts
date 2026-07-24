import { describe, it, expect } from "vitest";
import { closestCorners } from "@dnd-kit/core";
import { pointerFirstCollision } from "./KanbanBoard";

// Regression for #993 ("tasks not draggable to In review"). The board mixes big
// column-shell droppables with small card droppables. When a column is empty but
// flex-stretches to match a busy neighbor, closestCorners resolves a drop over
// the empty column to a *neighbor's card* instead — so the task silently saves
// into the wrong column and disappears from the column the user aimed at. These
// tests reconstruct that geometry (mid column empty, neighbors packed and tall)
// and assert closestCorners misfires while pointerFirstCollision does not.

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const COL_W = 256;
const GAP = 12;
const TOP = 100;
const CARD_H = 120;
const CARD_GAP = 8;
const LIST_PAD = 48;
const cols = ["Backlog", "Todo", "InProgress", "InReview", "Done", "Cancelled"];
const colLeft = (i: number) => i * (COL_W + GAP);
// InReview (index 3) is empty; its busy neighbors make every column stretch to
// the tallest via flex `align-items: stretch`.
const counts = [2, 4, 7, 0, 5, 1];
const contentH = (n: number) => LIST_PAD + Math.max(n * (CARD_H + CARD_GAP), 360) + 12;
const SHELL_H = Math.max(...counts.map(contentH));

const droppableRects = new Map<string, ReturnType<typeof rect>>();
cols.forEach((id, i) => droppableRects.set(id, rect(colLeft(i), TOP, COL_W, SHELL_H)));
cols.forEach((id, i) => {
  for (let r = 0; r < counts[i]; r++) {
    droppableRects.set(
      `${id}#${r}`,
      rect(colLeft(i) + 8, TOP + LIST_PAD + r * (CARD_H + CARD_GAP), COL_W - 16, CARD_H),
    );
  }
});
const droppableContainers = [...droppableRects.keys()].map((id) => ({ id })) as never;

// Pointer at (px, py); no DragOverlay, so the dragged card's rect follows the
// pointer with a small grab offset.
function args(px: number, py: number) {
  const collisionRect = rect(px - (COL_W - 16) / 2, py - 20, COL_W - 16, CARD_H);
  return {
    active: { id: "dragged", rect: { current: { initial: null, translated: collisionRect } } },
    collisionRect,
    droppableRects,
    droppableContainers,
    pointerCoordinates: { x: px, y: py },
  } as never;
}
const top = (fn: typeof closestCorners, px: number, py: number) => fn(args(px, py))[0]?.id;

// Sweep the pointer across the empty InReview column at several depths.
const irLeft = colLeft(3);
const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.round(irLeft + f * COL_W));
const ys = [TOP + LIST_PAD + 30, TOP + LIST_PAD + 200, TOP + LIST_PAD + 420];

describe("KanbanBoard collision detection over an empty stretched column (#993)", () => {
  it("closestCorners misfires: never resolves the empty InReview column", () => {
    const picks = ys.flatMap((y) => xs.map((x) => top(closestCorners, x, y)));
    // The bug: it lands on neighbor cards instead of the empty column.
    expect(picks).not.toContain("InReview");
    expect(picks.every((id) => typeof id === "string" && id.includes("#"))).toBe(true);
  });

  it("pointerFirstCollision resolves the empty InReview column everywhere over it", () => {
    for (const y of ys)
      for (const x of xs) expect(top(pointerFirstCollision, x, y)).toBe("InReview");
  });

  it("pointerFirstCollision still resolves a card when hovering one (reorder preserved)", () => {
    // Hover squarely over InProgress card #2 — must return the card, not the column,
    // so TaskBoard can compute a within-column insert index.
    const x = colLeft(2) + COL_W / 2;
    const y = TOP + LIST_PAD + 2 * (CARD_H + CARD_GAP) + CARD_H / 2;
    expect(top(pointerFirstCollision, x, y)).toBe("InProgress#2");
  });

  it("pointerFirstCollision falls back to closestCorners when the pointer is off all droppables", () => {
    const offX = colLeft(5) + COL_W + 400;
    const offY = TOP - 400;
    expect(top(pointerFirstCollision, offX, offY)).toBeDefined();
  });
});
