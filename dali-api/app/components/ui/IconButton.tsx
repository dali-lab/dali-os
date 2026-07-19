import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

// Hover/focus tooltip shown below the wrapped trigger. CSS-only (no JS
// positioning), driven by a named group so it never clashes with a `group` on
// the trigger itself. Use it to label icon-only controls: generic actions
// (edit, delete, copy…) drop their visible text and rely on this instead, while
// niche concepts (Partner view, New cycle) and tabs keep their text.
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-brand-2 transition-[opacity,transform] duration-100 group-hover/tt:translate-y-0 group-hover/tt:opacity-100 group-focus-within/tt:translate-y-0 group-focus-within/tt:opacity-100"
      >
        {label}
      </span>
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
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">;

// Icon-only button with a built-in tooltip + accessible name. The go-to for
// generic row/toolbar actions once their visible text is removed.
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, icon: Icon, tone = "default", className, iconClassName, type = "button", ...rest },
    ref,
  ) {
    return (
      <Tooltip label={label}>
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
