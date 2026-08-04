import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/cn";

// Custom radio — same peer pattern as Checkbox (native <input type="radio"> kept
// accessible; styled ring + inner dot as siblings after it). Use one per option
// with a shared `name`, matching the existing usage.

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function Radio({ label, description, className, disabled, ...props }: RadioProps) {
  return (
    <label
      className={cn(
        "inline-flex items-start gap-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative mt-0.5 h-4 w-4 shrink-0">
        <input type="radio" disabled={disabled} className="peer sr-only" {...props} />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-border bg-background transition-colors peer-checked:border-accent-coral peer-focus-visible:ring-2 peer-focus-visible:ring-accent-coral/40 peer-focus-visible:ring-offset-1"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto h-2 w-2 rounded-full bg-accent-coral opacity-0 transition-opacity peer-checked:opacity-100"
        />
      </span>
      {(label || description) && (
        <span className="flex min-w-0 flex-col">
          {label && <span className="text-sm text-foreground">{label}</span>}
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </span>
      )}
    </label>
  );
}
