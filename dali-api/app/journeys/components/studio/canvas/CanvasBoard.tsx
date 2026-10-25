import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Lock, Maximize, Minus, Plus, Trash2, Unlock } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { createCanvasItem, createHotspot } from "~/journeys/lib/studio";
import type { CanvasItem, Hotspot, StickyColor } from "~/journeys/lib/studio-types";
import type { Point } from "~/journeys/lib/types";
import { fitTransform, IDENTITY, toGraphPoint, zoomAround, type Transform } from "~/journeys/components/graph/graph-geometry";
import {
  boardBounds,
  canEdit,
  canEditHotspots,
  canMove,
  DRAG_THRESHOLD,
  FIT_PADDING,
  hotspotBox,
  isResizable,
  isTyping,
  itemBox,
  layer,
  MAX_ZOOM,
  MIN_ZOOM,
  pinNumbers,
  placesOnClick,
  resizeRect,
  roundPoint,
  roundRect,
  TOOL_SHORTCUTS,
  toolAllowed,
  type Corner,
  type Rect,
  type CanvasTool,
} from "./canvas-geometry";
import { HotspotFace, ImageFace, PinFace, ShapeFace, StickyFace, TextFace, type CanvasPatch } from "./CanvasNodes";
import { CanvasToolbar, ColorSwatches, PANEL } from "./CanvasToolbar";

export type CanvasBoardOptions = {
  items: CanvasItem[];
  onItemsChange?: (fn: (items: CanvasItem[]) => CanvasItem[]) => void;
  hotspots?: Hotspot[];
  onHotspotsChange?: (fn: (hs: Hotspot[]) => Hotspot[]) => void;
  mode: "learner" | "editor";
  readOnly?: boolean;
  showHotspots?: boolean;
  foundHotspotIds?: Set<string>;
};

const PLACING_HINTS: Partial<Record<CanvasTool, string>> = {
  sticky: "Click to place a sticky note",
  text: "Click to place a text label",
  shape: "Click to place a shape",
  pin: "Click where you want to leave a comment",
  hotspot: "Click to mark a hidden problem area",
};

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const HANDLE_CURSOR: Record<Corner, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
const DOT_GAP = 22;

type Target = "item" | "hotspot";
type Drag =
  | { kind: "pan"; startX: number; startY: number; origin: Transform }
  | { kind: "move"; id: string; target: Target; startX: number; startY: number; origin: Point; moved: boolean }
  | { kind: "resize"; id: string; target: Target; corner: Corner; startX: number; startY: number; origin: Rect; keepAspect: boolean };

/** A FigJam-style board: stickies, text, shapes, images and comment pins on a pannable, zoomable canvas. */
export function CanvasBoard({
  items,
  onItemsChange,
  hotspots = [],
  onHotspotsChange,
  mode,
  readOnly = false,
  showHotspots = false,
  foundHotspotIds,
}: CanvasBoardOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Transform>(IDENTITY);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<CanvasTool>("select");
  const [stickyColor, setStickyColor] = useState<StickyColor>("yellow");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; rect: Partial<Rect> } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const fitted = useRef(false);

  const visibleHotspots = showHotspots ? hotspots : [];
  const hotspotsEditable = canEditHotspots(mode, readOnly);
  const numbers = useMemo(() => pinNumbers(items), [items]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const hotspotById = useMemo(() => new Map(visibleHotspots.map((h) => [h.id, h])), [visibleHotspots]);

  const fit = useCallback(
    (viewport = size) => setView(fitTransform(boardBounds(items, visibleHotspots), viewport, FIT_PADDING, MIN_ZOOM, MAX_ZOOM)),
    [items, visibleHotspots, size],
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (fitted.current || size.width === 0) return;
    fitted.current = true;
    // An empty board fits to nothing, so centre the origin instead of pinning it to the corner.
    if (items.length === 0 && visibleHotspots.length === 0) setView({ x: size.width / 2, y: size.height / 2, k: 1 });
    else fit(size);
  }, [size, fit, items.length, visibleHotspots.length]);

  const toBoard = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      return toGraphPoint(view, { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) });
    },
    [view],
  );

  const updateItem = useCallback(
    (id: string, patch: CanvasPatch) => {
      if (hotspotById.has(id)) {
        const { label, x, y, width, height } = patch;
        onHotspotsChange?.((hs) =>
          hs.map((h) => (h.id === id ? { ...h, ...(label !== undefined ? { label } : {}), ...roundDefined({ x, y, width, height }) } : h)),
        );
      } else {
        onItemsChange?.((its) => its.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      }
    },
    [hotspotById, onItemsChange, onHotspotsChange],
  );

  const remove = useCallback(
    (id: string) => {
      onItemsChange?.((its) => its.filter((i) => i.id !== id));
      onHotspotsChange?.((hs) => hs.filter((h) => h.id !== id));
      setSelectedId((s) => (s === id ? null : s));
      setEditingId((s) => (s === id ? null : s));
    },
    [onItemsChange, onHotspotsChange],
  );

  const removable = useCallback(
    (id: string) => {
      const item = itemById.get(id);
      return item ? canEdit(item, mode, readOnly) : hotspotById.has(id) && hotspotsEditable;
    },
    [itemById, hotspotById, mode, readOnly, hotspotsEditable],
  );

  const place = (p: Point) => {
    if (!placesOnClick(tool)) return;
    if (tool === "hotspot") {
      const h = createHotspot(p.x, p.y);
      onHotspotsChange?.((hs) => [...hs, roundHotspot(h)]);
      setSelectedId(h.id);
      setEditingId(h.id);
    } else {
      const item = createCanvasItem(tool, p.x, p.y, stickyColor);
      onItemsChange?.((its) => [...its, { ...item, ...roundPoint(item) }]);
      setSelectedId(item.id);
      setEditingId(item.id);
    }
    setTool("select");
  };

  const addImage = (src: string, alt: string) => {
    const center = toGraphPoint(view, { x: size.width / 2, y: size.height / 2 });
    const item = createCanvasItem("image", center.x, center.y);
    onItemsChange?.((its) => [...its, { ...item, ...roundPoint(item), src, alt, locked: true }]);
    setSelectedId(item.id);
    setTool("select");
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest("[data-board-controls], textarea, input, button")) return;
    const start = { startX: e.clientX, startY: e.clientY };
    const pan = () => {
      dragRef.current = { kind: "pan", ...start, origin: view };
      containerRef.current?.setPointerCapture(e.pointerId);
    };
    if (spaceHeld) return pan();

    const handle = el.closest<HTMLElement>("[data-handle]");
    const node = el.closest<HTMLElement>("[data-node-id]");
    const id = node?.dataset.nodeId;
    const target = node?.dataset.nodeKind as Target | undefined;

    if (!readOnly && placesOnClick(tool)) {
      place(toBoard(e.clientX, e.clientY));
      return;
    }
    if (!id || !target) {
      setSelectedId(null);
      setEditingId(null);
      return pan();
    }

    const item = target === "item" ? itemById.get(id) : undefined;
    const hotspot = target === "hotspot" ? hotspotById.get(id) : undefined;
    const movable = item ? canMove(item, mode, readOnly) : Boolean(hotspot) && hotspotsEditable;
    const editable = item ? canEdit(item, mode, readOnly) : Boolean(hotspot) && hotspotsEditable;
    if (!movable && !editable) return pan();
    if (editingId !== id) setEditingId(null);
    setSelectedId(id);

    const box = item ? itemBox(item) : hotspotBox(hotspot!);
    if (handle && editable) {
      dragRef.current = {
        kind: "resize",
        id,
        target,
        corner: handle.dataset.handle as Corner,
        ...start,
        origin: box,
        keepAspect: item?.type === "image",
      };
    } else if (movable) {
      dragRef.current = { kind: "move", id, target, ...start, origin: { x: box.x, y: box.y }, moved: false };
    } else {
      return;
    }
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxScreen = e.clientX - drag.startX;
    const dyScreen = e.clientY - drag.startY;
    if (drag.kind === "pan") {
      setView({ ...drag.origin, x: drag.origin.x + dxScreen, y: drag.origin.y + dyScreen });
      return;
    }
    const dx = dxScreen / view.k;
    const dy = dyScreen / view.k;
    if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setPreview({ id: drag.id, rect: { x: drag.origin.x + dx, y: drag.origin.y + dy } });
    } else {
      setPreview({ id: drag.id, rect: resizeRect(drag.origin, drag.corner, dx, dy, drag.keepAspect) });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.kind === "pan" || !preview || preview.id !== drag.id) {
      setPreview(null);
      return;
    }
    const rect = preview.rect;
    if (drag.kind === "move") {
      updateItem(drag.id, roundPoint({ x: rect.x ?? drag.origin.x, y: rect.y ?? drag.origin.y }));
    } else {
      updateItem(drag.id, roundRect(rect as Rect));
    }
    setPreview(null);
  };

  const onDoubleClick = (e: MouseEvent) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>("[data-node-id]");
    const id = node?.dataset.nodeId;
    if (!id) return;
    const item = itemById.get(id);
    if (item ? canEdit(item, mode, readOnly) && item.type !== "image" : hotspotById.has(id) && hotspotsEditable) setEditingId(id);
  };

  // Native listener: React's onWheel is passive, so it can't stop the page from scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-board-controls], textarea")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        setView((v) => zoomAround(v, anchor, Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM));
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setTool("select");
        setEditingId(null);
        setSelectedId(null);
        return;
      }
      if (readOnly) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && removable(selectedId)) {
        e.preventDefault();
        remove(selectedId);
        return;
      }
      const next = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (next && toolAllowed(next, mode)) setTool(next);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [readOnly, mode, selectedId, removable, remove]);

  const zoomBy = (factor: number) => setView((v) => zoomAround(v, { x: size.width / 2, y: size.height / 2 }, factor, MIN_ZOOM, MAX_ZOOM));
  const placing = !readOnly && placesOnClick(tool);
  const stopEditing = () => setEditingId(null);

  const selectedItem = selectedId ? itemById.get(selectedId) : undefined;
  const selectedHotspot = selectedId ? hotspotById.get(selectedId) : undefined;
  const selectedEditable = selectedItem ? canEdit(selectedItem, mode, readOnly) : Boolean(selectedHotspot) && hotspotsEditable;
  const selectedBox = withPreview(selectedItem ? itemBox(selectedItem) : selectedHotspot ? hotspotBox(selectedHotspot) : null, preview, selectedId);

  const renderNode = (id: string, kind: Target, box: Rect, sized: boolean, z: number, editable: boolean, movable: boolean, face: ReactNode, resizable: boolean) => {
    const selected = selectedId === id;
    const b = withPreview(box, preview, id)!;
    return (
      <div
        key={id}
        data-node-id={id}
        data-node-kind={kind}
        className={cn("absolute", movable && !placing && "cursor-grab active:cursor-grabbing")}
        style={{ left: b.x, top: b.y, zIndex: z, ...(sized ? { width: b.width, height: b.height } : {}) }}
      >
        {face}
        {selected && editable && resizable && editingId !== id &&
          CORNERS.map((c) => (
            <span
              key={c}
              data-handle={c}
              aria-hidden
              className="absolute rounded-sm border-2 border-navy-deep bg-brand-white"
              style={{
                width: 10 / view.k,
                height: 10 / view.k,
                borderWidth: 2 / view.k,
                cursor: HANDLE_CURSOR[c],
                left: c.endsWith("w") ? -5 / view.k : undefined,
                right: c.endsWith("e") ? -5 / view.k : undefined,
                top: c.startsWith("n") ? -5 / view.k : undefined,
                bottom: c.startsWith("s") ? -5 / view.k : undefined,
              }}
            />
          ))}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Whiteboard"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      className={cn(
        "absolute inset-0 touch-none select-none overflow-hidden bg-[#EDEFF0]",
        placing ? "cursor-crosshair" : spaceHeld || dragRef.current?.kind === "pan" ? "cursor-grabbing" : "cursor-default",
      )}
      style={{
        backgroundImage: "radial-gradient(#BFC5C9 1.4px, transparent 1.4px)",
        backgroundSize: `${DOT_GAP * view.k}px ${DOT_GAP * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {items.map((item) => {
          const editable = canEdit(item, mode, readOnly);
          const movable = canMove(item, mode, readOnly);
          const face = {
            editing: editingId === item.id,
            editable,
            selected: selectedId === item.id,
            onUpdate: (patch: CanvasPatch) => updateItem(item.id, patch),
            onStopEditing: stopEditing,
          };
          const content =
            item.type === "sticky" ? <StickyFace item={item} {...face} />
            : item.type === "text" ? <TextFace item={item} {...face} />
            : item.type === "shape" ? <ShapeFace item={item} {...face} />
            : item.type === "image" ? <ImageFace item={item} selected={face.selected} />
            : <PinFace item={item} pinNumber={numbers.get(item.id)} {...face} />;
          return renderNode(item.id, "item", itemBox(item), isResizable(item), layer(item.type), editable, movable, content, isResizable(item));
        })}
        {visibleHotspots.map((h) =>
          renderNode(
            h.id,
            "hotspot",
            hotspotBox(h),
            true,
            layer("hotspot"),
            hotspotsEditable,
            hotspotsEditable,
            <HotspotFace
              hotspot={h}
              found={foundHotspotIds?.has(h.id)}
              editing={editingId === h.id}
              editable={hotspotsEditable}
              selected={selectedId === h.id}
              onUpdate={(patch) => updateItem(h.id, patch)}
              onStopEditing={stopEditing}
            />,
            true,
          ),
        )}
      </div>

      {selectedBox && selectedEditable && editingId !== selectedId && !preview && (
        <div
          data-board-controls
          className={cn(PANEL, "absolute z-30 flex -translate-x-1/2 items-center gap-1 p-1")}
          style={{ left: view.x + (selectedBox.x + selectedBox.width / 2) * view.k, top: view.y + selectedBox.y * view.k - 52 }}
        >
          {selectedItem?.type === "sticky" && (
            <ColorSwatches value={selectedItem.color} onChange={(color) => updateItem(selectedItem.id, { color })} />
          )}
          {mode === "editor" && selectedItem && (
            <IconButton
              label={selectedItem.locked ? "Locked for learners. Click to let them move it" : "Learners can move this. Click to lock it"}
              icon={selectedItem.locked ? Lock : Unlock}
              onClick={() => updateItem(selectedItem.id, { locked: !selectedItem.locked })}
            />
          )}
          <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={() => selectedId && remove(selectedId)} />
        </div>
      )}

      {placing && PLACING_HINTS[tool] && (
        <p className={cn(PANEL, "pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 whitespace-nowrap px-3 py-1.5 text-xs text-foreground")}>
          {PLACING_HINTS[tool]} · <span className="text-os-muted">Esc to cancel</span>
        </p>
      )}

      <div data-board-controls className={cn(PANEL, "absolute bottom-4 right-4 z-20 flex items-center gap-0.5 p-1")}>
        <IconButton label="Zoom out" icon={Minus} onClick={() => zoomBy(1 / 1.2)} tooltipSide="top" />
        <span className="w-12 text-center text-xs tabular-nums text-os-grey">{Math.round(view.k * 100)}%</span>
        <IconButton label="Zoom in" icon={Plus} onClick={() => zoomBy(1.2)} tooltipSide="top" />
        <IconButton label="Fit board to screen" icon={Maximize} onClick={() => fit()} tooltipSide="top" />
      </div>

      {!readOnly && (
        <CanvasToolbar tool={tool} onTool={setTool} stickyColor={stickyColor} onStickyColor={setStickyColor} mode={mode} onAddImage={addImage} />
      )}
    </div>
  );
}

function withPreview(box: Rect | null, preview: { id: string; rect: Partial<Rect> } | null, id: string | null): Rect | null {
  if (!box) return null;
  return preview && preview.id === id ? { ...box, ...preview.rect } : box;
}

function roundDefined(r: Partial<Rect>): Partial<Rect> {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, Math.round(v as number)]));
}

function roundHotspot(h: Hotspot): Hotspot {
  return { ...h, ...roundRect(h) };
}
