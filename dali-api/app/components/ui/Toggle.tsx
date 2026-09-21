import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/cn";

// Custom switch — the peer pattern again: a native <input type="checkbox"
// role="switch"> (accessible, keyboard-driven, form/controlled) hidden behind a
// styled track + thumb rendered as siblings after it.

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  description?: ReactNode;
  className?: string;
  /** Replaces (not extends) the label's default type, for surfaces with their
   *  own label scale — e.g. the Customize panel's rows. */
  labelClassName?: string;
  /** "os" fills the on state with the dali.os accent instead of brand coral. */
  tone?: "brand" | "os";
}

export function Toggle({ label, description, className, labelClassName, disabled, tone = "brand", ...props }: ToggleProps) {
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
        {/* The off track used `bg-border`, which is the same value the cards and
            wells around it draw their edges from — inside a muted container the
            switch vanished and read as a stray white dot. A mid-grey derived
            from the foreground keeps a visible track on every ground, in both
            themes, and the inset hairline gives it an edge of its own. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 rounded-full bg-muted-foreground/30 ring-1 ring-inset ring-black/10 transition-colors peer-checked:ring-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1",
            tone === "os"
              ? "peer-checked:bg-os-accent peer-focus-visible:ring-os-accent/40"
              : "peer-checked:bg-accent-coral peer-focus-visible:ring-accent-coral/40",
          )}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"
        />
      </span>
      {(label || description) && (
        <span className="flex min-w-0 flex-col">
          {label && <span className={labelClassName ?? "text-sm text-foreground"}>{label}</span>}
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </span>
      )}
    </label>
  );
}
