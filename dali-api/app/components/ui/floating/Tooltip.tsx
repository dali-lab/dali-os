import {
  cloneElement,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStyles,
  FloatingPortal,
  type Placement,
} from "@floating-ui/react";
import { Info } from "lucide-react";
import { cn } from "~/lib/cn";

// The one tooltip primitive. Built on @floating-ui/react like the rest of this
// folder (Popover/Menu/Select) so it flips/shifts off screen edges and portals
// out of overflow-clipped ancestors for free — no hand-rolled box tracking.
//
// Two dresses from one component:
//  • "label" — a compact dark chip for naming an icon-only control ("Delete").
//    Single line, never wraps, no pointer events.
//  • "rich"  — a card-surface panel that WRAPS to ~260px for a sentence or two
//    of explanatory copy (jargon definitions, "why is this disabled"). Hoverable
//    (safePolygon) so the reader can move onto it and select text.
//
// Opens on hover (after `delay`) and on keyboard focus; dismisses on Escape.
// `role="tooltip"` wires the accessible description automatically.

const LABEL_CLASS =
  "pointer-events-none whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-brand-2";

const RICH_CLASS =
  "max-w-[260px] rounded-md border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-brand-2";

export function Tooltip({
  content,
  children,
  placement = "top",
  variant = "label",
  delay = 250,
  disabled = false,
  className,
}: {
  /** The tip text/markup. `null`/`""` renders the trigger with no tooltip. */
  content: ReactNode;
  /** A single focusable trigger element (a button, a span, a pill…). */
  children: ReactElement;
  placement?: Placement;
  variant?: "label" | "rich";
  /** Hover open delay, ms. Focus opens immediately. */
  delay?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    move: false,
    delay: { open: delay, close: 0 },
    // rich tips are hoverable so the reader can move onto them; a safe polygon
    // keeps the tip open while the cursor travels the gap.
    handleClose: variant === "rich" ? safePolygon() : null,
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 120,
    initial: { opacity: 0, transform: "scale(0.97)" },
  });

  const childRef = (children as { ref?: unknown }).ref ?? (children.props as { ref?: unknown }).ref;
  const ref = useMergeRefs([refs.setReference, childRef as never]);
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        ref,
        ...getReferenceProps(children.props as Record<string, unknown>),
      } as Record<string, unknown>)
    : children;

  const hasContent = content !== null && content !== undefined && content !== "";

  return (
    <>
      {trigger}
      {!disabled && hasContent && isMounted && (
        <FloatingPortal>
          {/* Outer node owns positioning (floating-ui writes a translate
              transform here); inner node owns the open/close animation — keep
              them separate so the fade/scale transform can't clobber the
              positioning transform (which would drop the tip to 0,0). */}
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={cn("z-[70]", variant === "label" && "pointer-events-none")}
          >
            <div
              style={transitionStyles}
              className={cn(variant === "rich" ? RICH_CLASS : LABEL_CLASS, className)}
            >
              {content}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

// A muted ⓘ that reveals a `rich` tooltip — the affordance for explaining a
// jargon term or a process next to its label ("Essentiality ⓘ"). Renders as a
// real button so it's keyboard-reachable and tappable on touch.
export function InfoTip({
  content,
  placement = "top",
  className,
  iconClassName,
  label = "More information",
}: {
  content: ReactNode;
  placement?: Placement;
  className?: string;
  iconClassName?: string;
  /** Accessible name for the trigger. */
  label?: string;
}) {
  return (
    <Tooltip content={content} placement={placement} variant="rich">
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center align-middle text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
          className,
        )}
      >
        <Info className={cn("h-3.5 w-3.5", iconClassName)} aria-hidden />
      </button>
    </Tooltip>
  );
}
