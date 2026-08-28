import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/cn";

/** A floating card anchored next to an on-screen rect (a clicked event, a
 *  dragged slot, or the New button), Google-Calendar style — prefers the
 *  anchor's right side, flips left / shifts up to stay on-screen, and centers
 *  near the top when no anchor is given. Dismisses on Escape and on an outside
 *  mousedown; clicks inside the card or inside a floating dropdown portal (the
 *  card's own Selects / RepeatField) are not treated as outside. No dark
 *  backdrop — it's a popover, not a full-screen modal. */
export function AnchoredPopover({
  anchor,
  onClose,
  ariaLabel,
  className,
  draggable = false,
  children,
}: {
  anchor?: DOMRect | null;
  onClose: () => void;
  ariaLabel?: string;
  className?: string;
  // When true, mousedown on a [data-drag-handle] region (minus its buttons)
  // moves the card freely, overriding the anchored position until it closes.
  draggable?: boolean;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Free position once the user drags the card by its handle; overrides `pos`.
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);

  const startDrag = (e: React.MouseEvent) => {
    if (!draggable || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest("[data-drag-handle]")) return;
    if (target.closest("button,a,input,select,textarea")) return; // let the X (etc.) work
    const card = cardRef.current;
    if (!card) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const onMove = (mev: MouseEvent) => {
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const left = Math.max(8, Math.min(mev.clientX - offX, window.innerWidth - cw - 8));
      const top = Math.max(8, Math.min(mev.clientY - offY, window.innerHeight - ch - 8));
      setDragPos({ left, top });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      // The card's own dropdowns render into a portal at <body>, so they're not
      // inside cardRef — a click there isn't an outside click. Covers the Select
      // / RepeatField floating layers and the DateField / TimeField calendar
      // popovers (both role="dialog").
      const el = target instanceof Element ? target : (target.parentElement as Element | null);
      if (el?.closest("[data-floating-ui-portal],[data-calendar-popover],[role='dialog']")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocMouseDown, true);
    };
  }, [onClose]);

  // A fresh anchor means a fresh open — drop any leftover drag position.
  useLayoutEffect(() => setDragPos(null), [anchor]);

  useLayoutEffect(() => {
    const place = () => {
      const card = cardRef.current;
      if (!card) return;
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const gap = 8;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const a =
        anchor ??
        ({ left: vw / 2 - cw / 2, right: vw / 2 + cw / 2, top: 72, bottom: 72 } as DOMRect);
      let left = a.right + gap;
      if (left + cw + margin > vw) left = a.left - gap - cw; // flip to the left side
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      let top = a.top;
      if (top + ch + margin > vh) top = vh - ch - margin; // shift up to fit
      top = Math.max(margin, top);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  if (typeof document === "undefined") return null;

  const shown = dragPos ?? pos;
  return createPortal(
    <div
      ref={cardRef}
      data-calendar-popover
      role="dialog"
      aria-label={ariaLabel}
      onMouseDown={(e) => {
        e.stopPropagation();
        startDrag(e);
      }}
      className={cn("fixed z-50", className)}
      style={{ left: shown?.left ?? 0, top: shown?.top ?? 0, visibility: shown ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
