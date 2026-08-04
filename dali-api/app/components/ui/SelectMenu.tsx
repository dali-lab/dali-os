import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

// A custom single-select dropdown — the app's bespoke-popover look (the ⋯ menu /
// calendar pickers) rather than a native <select>, with per-option descriptions
// and a checkmark. The menu is portaled to <body> and positioned with fixed
// coordinates so it is NOT clipped inside a scrollable dialog (the usual reason
// native <select> gets used in modals).
//
// A drop-in for <select>, in either mode:
//   • Controlled: pass `value` + `onChange`.
//   • Form / uncontrolled: pass `name` (+ optional `defaultValue`). A hidden
//     native <select name> mirrors the value so it participates in <Form>
//     submission (request.formData()) exactly like the element it replaces.
//     `onChange` is optional here.

export type SelectMenuOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function SelectMenu<T extends string>({
  value,
  defaultValue,
  name,
  options,
  onChange,
  disabled = false,
  required = false,
  ariaLabel,
  placeholder,
  align = "left",
  buttonClassName,
}: {
  /** Controlled value. Omit for uncontrolled/form usage (see `name`). */
  value?: T;
  /** Initial value when uncontrolled. */
  defaultValue?: T;
  /** When set, renders a hidden native <select name> for <Form> submission. */
  name?: string;
  options: SelectMenuOption<T>[];
  onChange?: (value: T) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<T | undefined>(defaultValue);
  const selected = isControlled ? value : internal;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number } | null>(
    null,
  );

  function choose(v: T) {
    if (!isControlled) setInternal(v);
    onChange?.(v);
    setOpen(false);
  }

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

  const current = options.find((o) => o.value === selected);

  return (
    <>
      {/* Hidden native control so the value participates in native <Form>
          submission. Kept in sync with the visible custom UI; aria-hidden +
          tabIndex -1 so assistive tech and keyboard use the button instead. */}
      {name && (
        <select
          name={name}
          value={selected ?? ""}
          onChange={(e) => choose(e.target.value as T)}
          required={required}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
        >
          {selected === undefined && <option value="" />}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
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
        <span className={`truncate ${current ? "" : "text-muted-foreground"}`}>
          {current?.label ?? placeholder ?? selected ?? ""}
        </span>
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
                  aria-selected={o.value === selected}
                  disabled={o.disabled}
                  onClick={() => {
                    if (o.disabled) return;
                    choose(o.value);
                  }}
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Check
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${o.value === selected ? "text-accent-coral" : "opacity-0"}`}
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
