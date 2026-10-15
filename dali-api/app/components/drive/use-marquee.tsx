import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  idsInRect,
  marqueeSelection,
  pastThreshold,
  rectFromPoints,
  type Point,
  type Rect,
} from "~/components/drive/marquee";

/** Pointer-downs on these never start a rectangle: the rows themselves, and anything with its own click. */
const NOT_BACKGROUND = "[data-item-id],[data-marquee-ignore],button,a,input,label,select,textarea,[role='menuitem']";

type Options = {
  enabled: boolean;
  /** The selection at pointer-down, which a shift or cmd/ctrl drag adds to. */
  getSelected: () => ReadonlySet<string>;
  onSelect: (ids: string[]) => void;
  /** Runs once when a drag ends, so the click that follows it can be ignored. */
  onDragEnd: () => void;
};

const nextFrame = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 16);
  return () => clearTimeout(id);
};

/**
 * Rubber-band selection on a scrolling pane. The pane must be `relative`; render
 * `box` inside it. Rows are found by `data-item-id`, so the pane decides what is
 * selectable simply by what it contains.
 */
export function useMarquee({ enabled, getSelected, onSelect, onDragEnd }: Options) {
  const [box, setBox] = useState<Rect | null>(null);
  const gesture = useRef<{
    el: HTMLElement;
    origin: Point;
    last: Point;
    additive: boolean;
    base: ReadonlySet<string>;
    dragging: boolean;
    cancelFrame: (() => void) | null;
  } | null>(null);
  const latest = useRef({ onSelect, onDragEnd });
  latest.current = { onSelect, onDragEnd };

  useEffect(() => () => gesture.current?.cancelFrame?.(), []);

  function update(g: NonNullable<typeof gesture.current>) {
    g.cancelFrame = null;
    const rect = rectFromPoints(g.origin, g.last);
    const rows = Array.from(g.el.querySelectorAll<HTMLElement>("[data-item-id]")).map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.dataset.itemId!, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
    });
    latest.current.onSelect(marqueeSelection(g.base, idsInRect(rows, rect), g.additive));
    const c = g.el.getBoundingClientRect();
    setBox({
      left: rect.left - c.left - g.el.clientLeft + g.el.scrollLeft,
      top: rect.top - c.top - g.el.clientTop + g.el.scrollTop,
      right: rect.right - c.left - g.el.clientLeft + g.el.scrollLeft,
      bottom: rect.bottom - c.top - g.el.clientTop + g.el.scrollTop,
    });
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (!enabled || e.button !== 0 || e.isPrimary === false) return;
    if ((e.target as Element).closest(NOT_BACKGROUND)) return;
    const el = e.currentTarget;
    const origin = { x: e.clientX, y: e.clientY };
    gesture.current = {
      el,
      origin,
      last: origin,
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
      base: new Set(getSelected()),
      dragging: false,
      cancelFrame: null,
    };
    if (typeof el.setPointerCapture === "function") el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    g.last = { x: e.clientX, y: e.clientY };
    if (!g.dragging) {
      if (!pastThreshold(g.origin, g.last)) return;
      g.dragging = true;
    }
    if (!g.cancelFrame) g.cancelFrame = nextFrame(() => update(g));
  }

  function finish() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    g.cancelFrame?.();
    if (!g.dragging) return;
    update(g);
    setBox(null);
    latest.current.onDragEnd();
  }

  return { box, handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish } };
}

export function MarqueeBox({ box }: { box: Rect | null }) {
  if (!box) return null;
  return (
    <div
      data-testid="drive-marquee"
      aria-hidden="true"
      className="pointer-events-none absolute z-10 border border-os-accent bg-os-accent/10"
      style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }}
    />
  );
}
