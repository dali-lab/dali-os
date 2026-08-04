import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/cn";

// Custom switch — the peer pattern again: a native <input type="checkbox"
// role="switch"> (accessible, keyboard-driven, form/controlled) hidden behind a
// styled track + thumb rendered as siblings after it.

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function Toggle({ label, description, className, disabled, ...props }: ToggleProps) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-accent-coral peer-focus-visible:ring-2 peer-focus-visible:ring-accent-coral/40 peer-focus-visible:ring-offset-1"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"
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
