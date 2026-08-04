import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "~/lib/cn";

// Custom checkbox — a real native <input type="checkbox"> kept accessible (and
// so still keyboard-driven + submitted in a <Form> via `name`/`defaultChecked`
// + controllable via `checked`/`onChange`), visually hidden, with a styled box
// and check rendered as SIBLINGS AFTER it so Tailwind's `peer-checked:` can
// reach them (a nested check can't be targeted by the peer modifier).

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  description?: ReactNode;
  /** className goes on the wrapping <label>. */
  className?: string;
}

export function Checkbox({ label, description, className, disabled, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        "inline-flex items-start gap-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative mt-0.5 h-4 w-4 shrink-0">
        <input type="checkbox" disabled={disabled} className="peer sr-only" {...props} />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded border border-border bg-background transition-colors peer-checked:border-accent-coral peer-checked:bg-accent-coral peer-focus-visible:ring-2 peer-focus-visible:ring-accent-coral/40 peer-focus-visible:ring-offset-1"
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 h-full w-full scale-[0.65] text-white opacity-0 transition-opacity peer-checked:opacity-100"
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
