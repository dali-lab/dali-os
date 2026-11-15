import { useLayoutEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { cn } from "~/lib/cn";
import { Z } from "~/components/ui/z";
import { isInFloatingLayer } from "./outside";

const MARGIN = 8;
const UNANCHORED_TOP = 72;

export function AnchoredCard({
  anchor,
  onClose,
  ariaLabel,
  className,
  draggable = false,
  excludeRef,
  children,
}: {
  anchor?: DOMRect | null;
  onClose: () => void;
  ariaLabel?: string;
  className?: string;
  /** A mousedown on a [data-drag-handle] region (not on a button inside it) moves the card until it closes. */
  draggable?: boolean;
  /** A press on this node (usually the trigger) is not an outside press. */
  excludeRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    strategy: "fixed",
    placement: "right-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(MARGIN),
      flip({ padding: MARGIN, fallbackPlacements: ["left-start"] }),
      shift({ padding: MARGIN }),
    ],
  });

  useLayoutEffect(() => {
    refs.setPositionReference(anchor ? { getBoundingClientRect: () => anchor } : null);
    setDragPos(null);
  }, [anchor, refs]);

  const dismiss = useDismiss(context, {
    outsidePressEvent: "mousedown",
    outsidePress: (event) => {
      if (isInFloatingLayer(event.target)) return false;
      const path = event.composedPath();
      return !(excludeRef?.current && path.includes(excludeRef.current));
    },
  });
  const role = useRole(context, { role: "dialog" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const startDrag = (e: ReactMouseEvent) => {
    if (!draggable || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest("[data-drag-handle]")) return;
    if (target.closest("button,a,input,select,textarea")) return;
    const card = refs.floating.current;
    if (!card) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const onMove = (mev: MouseEvent) => {
      const left = Math.max(MARGIN, Math.min(mev.clientX - offX, window.innerWidth - card.offsetWidth - MARGIN));
      const top = Math.max(MARGIN, Math.min(mev.clientY - offY, window.innerHeight - card.offsetHeight - MARGIN));
      setDragPos({ left, top });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const style = dragPos
    ? { position: "fixed" as const, left: dragPos.left, top: dragPos.top }
    : anchor
      ? floatingStyles
      : { position: "fixed" as const, left: "50%", top: UNANCHORED_TOP, transform: "translateX(-50%)" };

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
        <div
          ref={refs.setFloating}
          data-calendar-popover
          aria-label={ariaLabel}
          {...getFloatingProps({
            onMouseDown: (e: ReactMouseEvent) => {
              e.stopPropagation();
              startDrag(e);
            },
          })}
          className={cn("fixed", Z.modal, className)}
          style={style}
        >
          {children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
