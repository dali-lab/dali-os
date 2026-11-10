import { useEffect, useState } from "react";
import { cn } from "~/lib/cn";

/** A small labelled whole-number box. It applies the value on Enter or blur, and Escape puts the old one back. */
export function NumberField({
  label,
  ariaLabel,
  value,
  onCommit,
  min,
  max,
  disabled = false,
  className,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  useEffect(() => setDraft(String(Math.round(value))), [value]);
  const commit = () => {
    const parsed = Number(draft.trim().replace("−", "-"));
    if (draft.trim() === "" || !Number.isFinite(parsed)) return setDraft(String(Math.round(value)));
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(parsed)));
    setDraft(String(next));
    if (next !== Math.round(value)) onCommit(next);
  };
  return (
    <label className={cn("flex min-w-0 items-center gap-1.5 rounded-lg border border-os-container px-2 py-1 text-sm focus-within:border-os-accent", disabled && "opacity-60", className)}>
      <span className="w-3 shrink-0 text-xs text-os-grey">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget.blur(), e.preventDefault());
          else if (e.key === "Escape") setDraft(String(Math.round(value)));
        }}
        className="min-w-0 flex-1 bg-transparent tabular-nums text-foreground focus:outline-none"
      />
    </label>
  );
}
