import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { expandToLeaves, explicitPlacement, placedElements, selectionTarget, type Placed } from "~/components/slides/deck/freeform";
import { boundsOf, intersects, rotatedBounds, type Handle, type Rect } from "~/components/slides/deck/geometry";
import { STAGE_H, STAGE_W } from "~/components/slides/deck/layouts";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { cn } from "~/lib/cn";
import { applyGesture, isDrag, marqueeRect, type Gesture, type GestureFrame, type GestureKind } from "./gesture";
import type { SnapPrefs } from "./snap-prefs";

export type ArmedTool = { type: "text" } | { type: "shape"; shape: "rect" | "rounded" | "ellipse" | "line" | "arrow" };

const HANDLES: Array<{ handle: Handle; left: string; top: string; cursor: string }> = [
  { handle: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { handle: "n", left: "50%", top: "0%", cursor: "ns-resize" },
  { handle: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { handle: "e", left: "100%", top: "50%", cursor: "ew-resize" },
  { handle: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
  { handle: "s", left: "50%", top: "100%", cursor: "ns-resize" },
  { handle: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { handle: "w", left: "0%", top: "50%", cursor: "ew-resize" },
];

const pct = (n: number, of: number) => `${(n / of) * 100}%`;
const boxStyle = (r: Rect & { rot?: number }) => ({
  position: "absolute" as const,
  left: pct(r.x, STAGE_W),
  top: pct(r.y, STAGE_H),
  width: pct(r.w, STAGE_W),
  height: pct(r.h, STAGE_H),
  ...(r.rot ? { transform: `rotate(${r.rot}deg)` } : {}),
});

const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : String(n));

export interface FreeformLayerProps {
  slide: RenderSlide;
  selection: string[];
  onSelect: (ids: string[]) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  prefs: SnapPrefs;
  armed: ArmedTool | null;
  onPlace: (tool: ArmedTool, at: { x: number; y: number }) => void;
  onLive: (live: Map<string, Placed> | null) => void;
  onCommit: (updates: Record<string, Placed>) => void;
  onActivate: (id: string) => void;
}

interface Active {
  gesture: Gesture | null;
  marquee: { from: { x: number; y: number }; base: string[] } | null;
  downPx: { x: number; y: number };
  moved: boolean;
  target: string | null;
  shift: boolean;
  wasSelected: boolean;
}

/** The editing surface over a slide: hit areas, selection frames, handles, guides and the marquee. Draws nothing the doc stores. */
export function FreeformLayer({ slide, selection, onSelect, editingId, onEdit, prefs, armed, onPlace, onLive, onCommit, onActivate }: FreeformLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<Active | null>(null);
  const latest = useRef({ slide, selection, onSelect, onEdit, onLive, onCommit, prefs });
  latest.current = { slide, selection, onSelect, onEdit, onLive, onCommit, prefs };
  const [frame, setFrame] = useState<GestureFrame | null>(null);
  const [kind, setKind] = useState<GestureKind["type"] | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const items = useMemo(() => placedElements(slide), [slide]);
  const leaves = useMemo(() => expandToLeaves(slide, selection), [slide, selection]);
  const selected = useMemo(() => items.filter((i) => leaves.includes(i.element.id)), [items, leaves]);
  const single = selection.length === 1 ? slide.elements.find((e) => e.id === selection[0]) : undefined;
  const singleItem = single && single.kind !== "group" ? selected.find((i) => i.element.id === single.id) : undefined;

  const toUnits = useCallback((clientX: number, clientY: number) => {
    const box = ref.current!.getBoundingClientRect();
    return { x: ((clientX - box.left) / box.width) * STAGE_W, y: ((clientY - box.top) / box.height) * STAGE_H };
  }, []);

  const listen = (onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    const up = (e: PointerEvent) => {
      cleanup.current?.();
      onUp(e);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cleanup.current = null;
    };
  };

  const startGesture = (e: ReactPointerEvent, gestureKind: GestureKind, ids: string[], target: string | null) => {
    const { slide: s, prefs: p } = latest.current;
    const chosen = expandToLeaves(s, ids);
    const start = new Map<string, Placed>();
    for (const item of placedElements(s)) if (chosen.includes(item.element.id)) start.set(item.element.id, item.placed);
    if (start.size === 0) return;
    const others = placedElements(s)
      .filter((i) => !chosen.includes(i.element.id))
      .map((i) => rotatedBounds(i.placed));
    const gesture: Gesture = {
      kind: gestureKind,
      start,
      others,
      snap: { threshold: (8 * STAGE_W) / ref.current!.getBoundingClientRect().width, items: p.items, margins: p.margins },
      origin: toUnits(e.clientX, e.clientY),
    };
    const state: Active = {
      gesture,
      marquee: null,
      downPx: { x: e.clientX, y: e.clientY },
      moved: false,
      target,
      shift: e.shiftKey,
      wasSelected: target !== null && latest.current.selection.includes(target),
    };
    active.current = state;
    let last: GestureFrame | null = null;
    listen(
      (ev) => {
        if (!state.moved && !isDrag(state.downPx, { x: ev.clientX, y: ev.clientY })) return;
        if (!state.moved) {
          state.moved = true;
          setKind(gestureKind.type);
        }
        last = applyGesture(gesture, toUnits(ev.clientX, ev.clientY), { shift: ev.shiftKey, skipSnap: ev.metaKey || ev.ctrlKey });
        setFrame(last);
        latest.current.onLive(last.placed);
      },
      () => {
        active.current = null;
        setFrame(null);
        setKind(null);
        latest.current.onLive(null);
        if (state.moved && last) latest.current.onCommit(Object.fromEntries(last.placed));
        else if (gestureKind.type === "move" && target) {
          const sel = latest.current.selection;
          if (!state.shift && sel.length > 1 && state.wasSelected) latest.current.onSelect([target]);
          else if (!state.shift && sel.length === 1 && sel[0] === target) {
            const el = latest.current.slide.elements.find((x) => x.id === target);
            if (el?.kind === "text") latest.current.onEdit(target);
          }
        }
      },
    );
  };

  const onItemDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (armed) {
      e.preventDefault();
      onPlace(armed, toUnits(e.clientX, e.clientY));
      return;
    }
    e.preventDefault();
    const target = selectionTarget(slide, id);
    onEdit(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (e.shiftKey) {
      onSelect(selection.includes(target) ? selection.filter((s) => s !== target) : [...selection, target]);
      return;
    }
    const next = selection.includes(target) ? selection : [target];
    if (next !== selection) onSelect(next);
    startGesture(e, { type: "move" }, next, target);
  };

  const onBackgroundDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (armed) {
      onPlace(armed, toUnits(e.clientX, e.clientY));
      return;
    }
    onEdit(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const from = toUnits(e.clientX, e.clientY);
    const base = e.shiftKey ? selection : [];
    if (!e.shiftKey) onSelect([]);
    const state: Active = { gesture: null, marquee: { from, base }, downPx: { x: e.clientX, y: e.clientY }, moved: false, target: null, shift: e.shiftKey, wasSelected: false };
    active.current = state;
    listen(
      (ev) => {
        if (!state.moved && !isDrag(state.downPx, { x: ev.clientX, y: ev.clientY })) return;
        state.moved = true;
        const rect = marqueeRect(from, toUnits(ev.clientX, ev.clientY));
        setMarquee(rect);
        const hit = placedElements(latest.current.slide)
          .filter((i) => intersects(rotatedBounds(i.placed), rect))
          .map((i) => selectionTarget(latest.current.slide, i.element.id));
        latest.current.onSelect([...new Set([...base, ...hit])]);
      },
      () => {
        active.current = null;
        setMarquee(null);
      },
    );
  };

  const selectionBounds = selected.length ? boundsOf(selected.map((i) => rotatedBounds(i.placed))) : null;
  const frameRect: (Rect & { rot?: number }) | null = singleItem ? { ...singleItem.placed } : selectionBounds;
  const grid = prefs.grid;
  const live = frame?.readout;

  return (
    <div
      ref={ref}
      data-freeform-layer
      className="absolute inset-0 select-none"
      style={{ zIndex: 4, touchAction: "none", cursor: armed ? "crosshair" : undefined }}
      onPointerDown={onBackgroundDown}
    >
      {grid && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, color-mix(in srgb, var(--os-accent-ink) 22%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--os-accent-ink) 22%, transparent) 1px, transparent 1px)",
            backgroundSize: `${(80 / STAGE_W) * 100}% ${(80 / STAGE_H) * 100}%`,
          }}
        />
      )}
      {items.map(({ element, placed }) => {
        const editing = editingId === element.id;
        return (
          <div
            key={element.id}
            data-hit={element.id}
            onPointerDown={(e) => onItemDown(e, element.id)}
            onDoubleClick={() => onActivate(element.id)}
            className={cn("absolute", editing ? "pointer-events-none" : "cursor-move")}
            style={boxStyle(placed)}
          />
        );
      })}
      {frameRect && (
        <div data-selection-frame style={{ ...boxStyle(frameRect), pointerEvents: "none" }} className="border-[1.5px] border-os-accent">
          {editingId !== null && singleItem && (
            <>
              {(["top", "bottom"] as const).map((side) => (
                <div
                  key={side}
                  data-move-grip
                  onPointerDown={(e) => onItemDown(e, singleItem.element.id)}
                  className="pointer-events-auto absolute cursor-move"
                  style={{ left: -6, right: -6, height: 8, [side]: -8 }}
                />
              ))}
              {(["left", "right"] as const).map((side) => (
                <div
                  key={side}
                  data-move-grip
                  onPointerDown={(e) => onItemDown(e, singleItem.element.id)}
                  className="pointer-events-auto absolute cursor-move"
                  style={{ top: -6, bottom: -6, width: 8, [side]: -8 }}
                />
              ))}
            </>
          )}
          {singleItem && (
            <>
              {HANDLES.map((h) => (
                <button
                  key={h.handle}
                  type="button"
                  tabIndex={-1}
                  aria-label={`Resize ${h.handle}`}
                  data-handle={h.handle}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    const el = singleItem.element;
                    startGesture(
                      e,
                      { type: "resize", handle: h.handle, lockRatio: el.kind === "image", thin: el.shape === "line" || el.shape === "arrow" },
                      [el.id],
                      el.id,
                    );
                  }}
                  className="pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-os-accent bg-os-card"
                  style={{ left: h.left, top: h.top, cursor: h.cursor }}
                />
              ))}
              <button
                type="button"
                tabIndex={-1}
                aria-label="Rotate"
                data-handle="rotate"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.preventDefault();
                  startGesture(e, { type: "rotate" }, [singleItem.element.id], singleItem.element.id);
                }}
                className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-os-accent bg-os-card"
                style={{ left: "50%", top: -28 }}
              />
              <span aria-hidden className="pointer-events-none absolute w-px bg-os-accent" style={{ left: "50%", top: -18, height: 18 }} />
              {kind === "rotate" && live && (
                <span data-rotate-badge className="absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-os-accent px-1.5 py-0.5 text-[11px] font-medium text-os-bg" style={{ left: "50%", top: -52 }}>
                  {signed(Math.round(live.rot))}°
                </span>
              )}
            </>
          )}
        </div>
      )}
      {singleItem && singleItem.element.slot !== null && explicitPlacement(singleItem.element) && !frame && (
        <span
          data-freeform-badge
          className="pointer-events-none absolute whitespace-nowrap rounded-md bg-os-accent px-1.5 py-0.5 text-[11px] font-medium text-os-bg"
          style={{ left: pct(singleItem.placed.x, STAGE_W), top: pct(singleItem.placed.y, STAGE_H), transform: "translateY(-150%)" }}
        >
          {singleItem.placed.rot ? `Freeform ${signed(Math.round(singleItem.placed.rot))}°` : "Freeform"}
        </span>
      )}
      {frame?.guides.map((g, i) => (
        <span
          key={`g${i}`}
          data-guide={g.axis}
          aria-hidden
          className="pointer-events-none absolute bg-os-accent"
          style={
            g.axis === "x"
              ? { left: pct(g.pos, STAGE_W), top: pct(g.from, STAGE_H), height: pct(g.to - g.from, STAGE_H), width: 1 }
              : { top: pct(g.pos, STAGE_H), left: pct(g.from, STAGE_W), width: pct(g.to - g.from, STAGE_W), height: 1 }
          }
        />
      ))}
      {frame?.gaps.map((g, i) => (
        <span
          key={`s${i}`}
          data-gap={g.value}
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center"
          style={
            g.axis === "x"
              ? { left: pct(g.from, STAGE_W), width: pct(g.to - g.from, STAGE_W), top: pct(g.at, STAGE_H), height: 0 }
              : { top: pct(g.from, STAGE_H), height: pct(g.to - g.from, STAGE_H), left: pct(g.at, STAGE_W), width: 0 }
          }
        >
          <span className="absolute bg-os-accent" style={g.axis === "x" ? { left: 0, right: 0, height: 1 } : { top: 0, bottom: 0, width: 1 }} />
          <span className="relative rounded-full bg-os-accent px-1.5 text-[10px] font-semibold leading-4 text-os-bg">{g.value}</span>
        </span>
      ))}
      {frame && live && kind !== "rotate" && selectionBounds && (
        <span
          data-readout
          className="pointer-events-none absolute whitespace-nowrap rounded-md bg-os-card px-1.5 py-0.5 text-[11px] font-medium text-os-fg shadow-sm ring-1 ring-os-container"
          style={{ left: pct(selectionBounds.x, STAGE_W), top: pct(selectionBounds.y + selectionBounds.h, STAGE_H), transform: "translateY(8px)" }}
        >
          {kind === "resize" ? `W ${live.w} · H ${live.h}` : `X ${live.x} · Y ${live.y}`}
        </span>
      )}
      {marquee && (
        <span data-marquee aria-hidden className="pointer-events-none absolute border border-os-accent bg-os-accent/10" style={boxStyle(marquee)} />
      )}
    </div>
  );
}
