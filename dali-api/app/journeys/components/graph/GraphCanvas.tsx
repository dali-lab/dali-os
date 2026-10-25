import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import type { Point } from "~/journeys/lib/types";
import {
  IDENTITY,
  boxesKey,
  contentBounds,
  fitTransform,
  toGraphPoint,
  zoomAround,
  type NodeBox,
  type Transform,
} from "./graph-geometry";

const DOT_GAP = 24;
const BUTTON_ZOOM = 1.2;
/** Screen pixels a press may wander before it counts as a drag rather than a click. */
export const DRAG_THRESHOLD = 4;

export interface GraphView {
  transform: Transform;
  /** Client (pointer event) coords to graph coords. */
  toGraph: (clientX: number, clientY: number) => Point;
}

const GraphViewContext = createContext<GraphView>({
  transform: IDENTITY,
  toGraph: (x, y) => ({ x, y }),
});

export function useGraphView(): GraphView {
  return useContext(GraphViewContext);
}

/**
 * Measured node heights by id. Edges attach at a node's vertical centre, and
 * card heights vary with the title's line count, so they're read off the DOM.
 */
export function useNodeHeights() {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observer = useRef<ResizeObserver | null>(null);
  const elements = useRef(new Map<Element, string>());

  useEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next = prev;
        for (const entry of entries) {
          const id = elements.current.get(entry.target);
          const h = (entry.target as HTMLElement).offsetHeight;
          if (id && h && prev[id] !== h) next = { ...next, [id]: h };
        }
        return next;
      });
    });
    for (const el of elements.current.keys()) observer.current.observe(el);
    return () => observer.current?.disconnect();
  }, []);

  // One stable ref callback per id, so re-renders don't detach and re-observe.
  const callbacks = useRef(new Map<string, (el: HTMLElement | null) => () => void>());
  const measure = useCallback((id: string) => {
    let cb = callbacks.current.get(id);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) {
          elements.current.set(el, id);
          observer.current?.observe(el);
        }
        return () => {
          if (!el) return;
          elements.current.delete(el);
          observer.current?.unobserve(el);
        };
      };
      callbacks.current.set(id, cb);
    }
    return cb;
  }, []);

  return { heights, measure };
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-graph-node],[data-graph-edge],[data-graph-controls]"));
}

/**
 * A pan/zoom viewport over graph space. Nodes are children positioned in graph
 * coords; `edges` is SVG content drawn underneath them in the same coords. The
 * parent must give it a definite size (it fills its container absolutely).
 */
export function GraphCanvas({
  boxes,
  edges,
  children,
  onPaneClick,
  refitOnChange = true,
  className,
  label,
  viewRef,
}: {
  /** Every node's box, for fitting the view to the content. */
  boxes: NodeBox[];
  edges?: ReactNode;
  children?: ReactNode;
  onPaneClick?: () => void;
  /** Refit when the set of nodes changes, not only on first layout. */
  refitOnChange?: boolean;
  className?: string;
  label: string;
  /** Filled with the live view, for pointer handlers owned by the caller. */
  viewRef?: { current: GraphView | null };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [ready, setReady] = useState(false);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const size = { width: el.clientWidth, height: el.clientHeight };
    if (!size.width || !size.height) return;
    setTransform(fitTransform(contentBounds(boxesRef.current), size));
    setReady(true);
  }, []);

  const key = boxesKey(boxes);
  const fittedKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (fittedKey.current !== null && (!refitOnChange || fittedKey.current === key)) return;
    const el = containerRef.current;
    if (!el?.clientWidth) return;
    fittedKey.current = key;
    fit();
  }, [key, refitOnChange, fit]);

  // The first fit waits for the container to have a size (it can mount at 0
  // inside a collapsing layout).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (fittedKey.current === null && el.clientWidth) {
        fittedKey.current = boxesKey(boxesRef.current);
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const viewportPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  // A native listener: React's wheel handler is passive, so it can't stop the
  // page from scrolling while the pointer is over the map.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setTransform((t) => zoomAround(t, viewportPoint(e.clientX, e.clientY), factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewportPoint]);

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ moved: boolean; start: Point; pinch?: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractive(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { moved: true, start: a, pinch: Math.hypot(a.x - b.x, a.y - b.y) };
    } else {
      gesture.current = { moved: false, start: { x: e.clientX, y: e.clientY } };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      setTransform((t) => zoomAround(t, mid, dist / g.pinch!));
      g.pinch = dist;
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < DRAG_THRESHOLD) return;
    g.moved = true;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (g && !g.moved && e.type === "pointerup") onPaneClick?.();
    } else if (g) {
      g.pinch = undefined;
    }
  };

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    const center = { x: (el?.clientWidth ?? 0) / 2, y: (el?.clientHeight ?? 0) / 2 };
    setTransform((t) => zoomAround(t, center, factor));
  };

  const view = useMemo<GraphView>(
    () => ({
      transform,
      toGraph: (clientX, clientY) => toGraphPoint(transformRef.current, viewportPoint(clientX, clientY)),
    }),
    [transform, viewportPoint],
  );
  if (viewRef) viewRef.current = view;

  const gap = DOT_GAP * transform.k;
  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={label}
      className={cn("absolute inset-0 touch-none select-none overflow-hidden", className)}
      style={{
        backgroundImage: "radial-gradient(circle, var(--color-os-container) 1px, transparent 1.2px)",
        backgroundSize: `${gap}px ${gap}px`,
        backgroundPosition: `${transform.x}px ${transform.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <GraphViewContext.Provider value={view}>
        <div
          className={cn("absolute left-0 top-0 origin-top-left", !ready && "invisible")}
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` }}
        >
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
            {edges}
          </svg>
          {children}
        </div>
      </GraphViewContext.Provider>

      <div
        data-graph-controls
        className="absolute bottom-4 left-4 flex flex-col overflow-hidden rounded-os-item border border-os-container bg-os-card"
      >
        <IconButton label="Zoom in" icon={Plus} tooltipSide="top" className="rounded-none p-2" onClick={() => zoomBy(BUTTON_ZOOM)} />
        <IconButton label="Zoom out" icon={Minus} tooltipSide="top" className="rounded-none p-2" onClick={() => zoomBy(1 / BUTTON_ZOOM)} />
        <IconButton label="Fit to view" icon={Maximize} tooltipSide="top" className="rounded-none p-2" onClick={fit} />
      </div>
    </div>
  );
}
