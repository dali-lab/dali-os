import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "~/lib/cn";

/** A pill that toggles on and off, for picking several options from a short set (an audience). */
export function ToggleChip({
  on,
  onToggle,
  children,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? "border-os-accent bg-os-accent/15 text-os-accent"
          : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
      )}
    >
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
      {children}
    </button>
  );
}
