import { cn } from "~/lib/cn";

export type SegmentedOption<T extends string> = { value: T; label: string; count?: number };

/** A short either/or choice drawn as one pill with a thumb on the picked side. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  fullWidth = false,
  size = "sm",
  pill = false,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  /** Stretch across the container, splitting it evenly between options. */
  fullWidth?: boolean;
  size?: "sm" | "md";
  /** Fully rounded capsule instead of the square-cornered switcher. */
  pill?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        // Square corners match the sidebar's active row; pill matches the
        // dali.os badge/pill shape language.
        pill ? "rounded-full" : "rounded-lg",
        "border border-border bg-muted/40",
        size === "md" ? "p-1" : "p-0.5",
        fullWidth ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.value)}
            className={cn(
              // 36px total at md (28px thumb inside the 4px-padded frame).
              "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40",
              pill ? "rounded-full" : "rounded-md",
              size === "md" ? "h-7 text-sm" : "h-6 text-xs",
              // Full width splits the row evenly, so side padding would only
              // push a long label past its share.
              fullWidth ? "min-w-0 flex-1 truncate px-1.5" : size === "md" ? "px-4" : "px-3",
              "whitespace-nowrap",
              checked ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count != null && <span className="ml-1.5 tabular-nums opacity-60">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
