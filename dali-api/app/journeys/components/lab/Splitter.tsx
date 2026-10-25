import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/cn";

function readSize(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function clampSize(size: number, minFirst: number, minSecond: number): number {
  return Math.min(100 - minSecond, Math.max(minFirst, size));
}

/**
 * Two panes with a draggable divider. `defaultSize` and the mins are percents
 * of the container; the first pane's size persists under `storageKey`.
 */
export function Splitter({
  direction,
  first,
  second,
  defaultSize = 50,
  minFirst = 10,
  minSecond = 10,
  storageKey,
  className,
}: {
  direction: "horizontal" | "vertical";
  first: ReactNode;
  second: ReactNode;
  defaultSize?: number;
  minFirst?: number;
  minSecond?: number;
  storageKey?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(defaultSize);
  const [dragging, setDragging] = useState(false);
  const horizontal = direction === "horizontal";

  // Read after mount so server and client render the same first frame.
  useEffect(() => {
    setSize(clampSize(readSize(storageKey, defaultSize), minFirst, minSecond));
  }, [storageKey, defaultSize, minFirst, minSecond]);

  const persist = useCallback(
    (value: number) => {
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, String(Math.round(value * 10) / 10));
      } catch {
        // Storage can be unavailable (private mode); the split just won't persist.
      }
    },
    [storageKey],
  );

  const sizeAt = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return size;
    const raw = horizontal
      ? ((e.clientX - rect.left) / rect.width) * 100
      : ((e.clientY - rect.top) / rect.height) * 100;
    return clampSize(raw, minFirst, minSecond);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) setSize(sizeAt(e));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const next = sizeAt(e);
    setSize(next);
    persist(next);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const back = horizontal ? "ArrowLeft" : "ArrowUp";
    const fwd = horizontal ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    const next = clampSize(size + (e.key === fwd ? 2 : -2), minFirst, minSecond);
    setSize(next);
    persist(next);
  };

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 min-w-0", horizontal ? "flex-row" : "flex-col", dragging && "select-none", className)}
    >
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flexBasis: `${size}%`, flexGrow: 0, flexShrink: 0 }}>
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(size)}
        aria-valuemin={minFirst}
        aria-valuemax={100 - minSecond}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cn(
          "relative shrink-0 bg-os-container transition-colors hover:bg-os-accent/70 focus-visible:bg-os-accent focus-visible:outline-none",
          dragging && "bg-os-accent",
          horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        )}
      >
        <span className={cn("absolute", horizontal ? "-inset-x-1.5 inset-y-0" : "-inset-y-1.5 inset-x-0")} />
      </div>
      {/* While dragging, iframes underneath would swallow pointer events. */}
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", dragging && "pointer-events-none")}>{second}</div>
    </div>
  );
}
