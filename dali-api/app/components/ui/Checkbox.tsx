import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "~/lib/cn";

// Custom checkbox — a real native <input type="checkbox"> kept accessible (and
// so still keyboard-driven + submitted in a <Form> via `name`/`defaultChecked`
// + controllable via `checked`/`onChange`), visually hidden, with a styled box
// and check rendered as SIBLINGS AFTER it so Tailwind's `peer-checked:` can
// reach them (a nested check can't be targeted by the peer modifier).

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: ReactNode;
  description?: ReactNode;
  /** className goes on the wrapping <label>. */
  className?: string;
  /** "os" fills the checked state with the dali.os accent instead of brand coral. */
  tone?: "brand" | "os";
  /** "lg" is the dali.os page scale: a 20px round check and a 16px label. */
  size?: "md" | "lg";
}

export function Checkbox({ label, description, className, disabled, tone = "brand", size = "md", ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        cn("inline-flex items-start", size === "lg" ? "gap-3" : "gap-2"),
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <span className={cn("relative mt-0.5 shrink-0", size === "lg" ? "h-5 w-5" : "h-4 w-4")}>
        <input type="checkbox" disabled={disabled} className="peer sr-only" {...props} />
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 border border-border bg-background transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1",
            size === "lg" ? "rounded-full" : "rounded",
            tone === "os"
              ? "peer-checked:border-os-accent peer-checked:bg-os-accent peer-focus-visible:ring-os-accent/40"
              : "peer-checked:border-accent-coral peer-checked:bg-accent-coral peer-focus-visible:ring-accent-coral/40",
          )}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 h-full w-full scale-[0.65] text-white opacity-0 transition-opacity peer-checked:opacity-100"
        />
      </span>
      {(label || description) && (
        <span className="flex min-w-0 flex-col">
          {label && <span className={cn(size === "lg" ? "text-base" : "text-sm", "text-foreground")}>{label}</span>}
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </span>
      )}
    </label>
  );
}
