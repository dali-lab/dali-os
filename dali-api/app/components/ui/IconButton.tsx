import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { Tooltip } from "./floating/Tooltip";

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
  /** Prefer `top` in table headers where a bottom tip would be clipped. */
  tooltipSide?: "top" | "bottom";
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
      ...rest
    },
    ref,
  ) {
    return (
      <Tooltip content={label} placement={tooltipSide}>
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
