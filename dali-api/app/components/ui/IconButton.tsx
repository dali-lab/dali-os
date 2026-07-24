import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

// Hover/focus tooltip. CSS-only by default (relative to the trigger). Pass
// `portal` when the trigger sits inside an overflow-clipped ancestor (tables,
// scroll panes) so the tip isn't cut off — it then renders fixed to the
// document and tracks the trigger's viewport box.
export function Tooltip({
  label,
  children,
  className,
  side = "bottom",
  portal = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom";
  portal?: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<DOMRect | null>(null);
  const tipId = useId();

  const updateBox = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setBox(el.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!portal || !open) return;
    updateBox();
    const onScrollOrResize = () => updateBox();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [portal, open, updateBox]);

  const tipClass =
    "pointer-events-none z-50 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-brand-2";

  if (!portal) {
    return (
      <span className={cn("group/tt relative inline-flex", className)}>
        {children}
        <span
          role="tooltip"
          className={cn(
            tipClass,
            "absolute left-1/2 -translate-x-1/2 opacity-0 transition-[opacity,transform] duration-100",
            "group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
            side === "top"
              ? "bottom-full mb-1.5 translate-y-1 group-hover/tt:translate-y-0 group-focus-within/tt:translate-y-0"
              : "top-full mt-1.5 translate-y-1 group-hover/tt:translate-y-0 group-focus-within/tt:translate-y-0",
          )}
        >
          {label}
        </span>
      </span>
    );
  }

  return (
    <span
      ref={triggerRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => {
        setOpen(true);
        updateBox();
      }}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => {
        setOpen(true);
        updateBox();
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      {children}
      {open &&
        box &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            id={tipId}
            role="tooltip"
            className={tipClass}
            style={{
              position: "fixed",
              left: box.left + box.width / 2,
              top: side === "top" ? box.top - 6 : box.bottom + 6,
              transform:
                side === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

const TONES = {
  default: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
  destructive: "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
} as const;

type IconButtonProps = {
  /** Required — becomes both the accessible name (aria-label) and the tooltip. */
  label: string;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  iconClassName?: string;
  /** Prefer `top` in table headers; use `portal` when an ancestor clips overflow. */
  tooltipSide?: "top" | "bottom";
  tooltipPortal?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">;

// Icon-only button with a built-in tooltip + accessible name. The go-to for
// generic row/toolbar actions once their visible text is removed.
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      icon: Icon,
      tone = "default",
      className,
      iconClassName,
      type = "button",
      tooltipSide = "bottom",
      tooltipPortal = false,
      ...rest
    },
    ref,
  ) {
    return (
      <Tooltip label={label} side={tooltipSide} portal={tooltipPortal}>
        <button
          ref={ref}
          type={type}
          aria-label={label}
          className={cn(
            "inline-flex items-center justify-center rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
            TONES[tone],
            className,
          )}
          {...rest}
        >
          <Icon className={cn("h-4 w-4", iconClassName)} aria-hidden />
        </button>
      </Tooltip>
    );
  },
);
