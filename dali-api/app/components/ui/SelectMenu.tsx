import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

// A small custom single-select dropdown — the app's bespoke-popover look (the ⋯
// menu / calendar pickers) rather than a native <select>, with per-option
// descriptions and a checkmark. The menu is portaled to <body> and positioned
// with fixed coordinates so it is NOT clipped inside a scrollable dialog (the
// usual reason native <select> gets used in modals).

export type SelectMenuOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  align = "left",
  buttonClassName,
}: {
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const minWidth = Math.max(r.width, 200);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 220 && r.top > spaceBelow;
    const left =
      align === "right"
        ? Math.max(8, r.right - minWidth)
        : Math.min(r.left, window.innerWidth - minWidth - 8);
    setPos(
      openUp
        ? { bottom: window.innerHeight - r.top + 4, left, minWidth }
        : { top: r.bottom + 4, left, minWidth },
    );
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // A scroll or resize invalidates the fixed position — just close.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={
          buttonClassName ??
          "inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60 disabled:hover:bg-transparent"
        }
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.minWidth }}
            className="z-[60] max-w-[18rem] rounded-md border border-border bg-card p-1 shadow-brand-2"
          >
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  disabled={o.disabled}
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Check
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${o.value === value ? "text-accent-coral" : "opacity-0"}`}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">{o.label}</span>
                    {o.description && (
                      <span className="text-xs text-muted-foreground">{o.description}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
