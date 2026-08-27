import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { cn } from "~/lib/cn";

// A time combobox, Google-Calendar style: type any time (freely, non-15-min
// included) OR pick from a dropdown of stepped options. The value is the LITERAL
// wall-clock 24h string "HH:mm" (or "") — no Date, no timezone — so it drops in
// beside DateField's date value to rebuild a datetime-local string.

const pad = (n: number) => String(n).padStart(2, "0");

/** 24h "HH:mm" → "9:40 AM". Empty string for a malformed/empty value. */
export function formatTime12(hhmm: string): string {
  const p = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!p) return "";
  const h = +p[1]!;
  const m = +p[2]!;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

/** Parse flexible input → "HH:mm" 24h, or null. Handles "9", "9:07", "930",
 *  "1345", "9:07 am", "9pm", etc. Bare numbers are read as 24h. */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const isPm = /p/.test(s);
  const isAm = /a/.test(s);
  const cleaned = s.replace(/[^0-9:]/g, "");
  if (!cleaned) return null;
  let h: number;
  let m: number;
  if (cleaned.includes(":")) {
    const [hp, mp = ""] = cleaned.split(":");
    h = parseInt(hp || "0", 10);
    m = parseInt(mp.slice(0, 2) || "0", 10);
  } else if (cleaned.length <= 2) {
    h = parseInt(cleaned, 10);
    m = 0;
  } else if (cleaned.length === 3) {
    h = parseInt(cleaned.slice(0, 1), 10);
    m = parseInt(cleaned.slice(1), 10);
  } else {
    h = parseInt(cleaned.slice(0, 2), 10);
    m = parseInt(cleaned.slice(2, 4), 10);
  }
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (isPm || isAm) {
    if (h < 1 || h > 12) return null; // meridiem implies a 12h clock
    if (h === 12) h = 0;
    if (isPm) h += 12;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export function TimeField({
  value,
  onChange,
  step = 15,
  className,
  ariaLabel,
  placeholder = "Pick a time",
}: {
  /** 24h "HH:mm" or "". */
  value: string;
  onChange: (value: string) => void;
  /** Dropdown increment in minutes. Typing still accepts any minute. */
  step?: number;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatTime12(value));
  const [activeIdx, setActiveIdx] = useState(-1);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const optRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Reflect an external value change while the user isn't mid-type.
  useEffect(() => {
    if (!focused) setText(formatTime12(value));
  }, [value, focused]);

  const options = useMemo(() => {
    const out: { v: string; label: string }[] = [];
    for (let mins = 0; mins < 1440; mins += step) {
      const v = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
      out.push({ v, label: formatTime12(v) });
    }
    return out;
  }, [step]);

  // Filter by what's typed; fall back to the full list so there's always
  // something to pick (a free time still commits on Enter/blur).
  const filtered = useMemo(() => {
    const q = norm(text);
    if (!q) return options;
    const f = options.filter((o) => norm(o.label).startsWith(q));
    return f.length ? f : options;
  }, [options, text]);
  optRefs.current = [];

  const reposition = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 140) });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Native (not synthetic) so stopPropagation reaches a parent popover's own
    // window-level Escape listener — closes just this list, not the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        setText(formatTime12(value));
      }
    };
    const onScroll = () => reposition();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, value]);

  // Scroll the current/active option into view when the list opens.
  useEffect(() => {
    if (!open) return;
    const idx = activeIdx >= 0 ? activeIdx : filtered.findIndex((o) => o.v === value);
    if (idx >= 0) optRefs.current[idx]?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commitText = () => {
    const parsed = parseTimeInput(text);
    if (parsed) {
      onChange(parsed);
      setText(formatTime12(parsed));
    } else {
      setText(formatTime12(value)); // revert to last valid
    }
  };

  const choose = (v: string) => {
    onChange(v);
    setText(formatTime12(v));
    setOpen(false);
    setActiveIdx(-1);
  };

  return (
    <div ref={wrapRef} className={cn("relative inline-block", className)}>
      <div className="flex w-full items-center rounded-md border border-border bg-background focus-within:border-accent-coral">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          value={text}
          placeholder={placeholder}
          onFocus={(e) => {
            setFocused(true);
            setOpen(true);
            e.currentTarget.select();
          }}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) setOpen(true);
              setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && activeIdx >= 0 && filtered[activeIdx]) choose(filtered[activeIdx]!.v);
              else {
                commitText();
                setOpen(false);
              }
            }
            // Escape is handled by a native document listener (see effect) so it
            // can stopPropagation before a parent popover's window listener sees it.
          }}
          className="w-full min-w-0 bg-transparent px-2.5 py-1.5 text-sm text-foreground focus:outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={ariaLabel ? `${ariaLabel} options` : "Time options"}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="pr-2 text-muted-foreground"
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
            className="z-[60] max-h-56 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-brand-2"
            // Keep focus in the input so blur-commit doesn't fire mid-pick.
            onMouseDown={(e) => e.preventDefault()}
          >
            {filtered.map((o, i) => {
              const selected = o.v === value;
              const active = i === activeIdx;
              return (
                <button
                  key={o.v}
                  type="button"
                  ref={(el) => {
                    optRefs.current[i] = el;
                  }}
                  onClick={() => choose(o.v)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm",
                    active ? "bg-muted" : "",
                    selected ? "font-semibold text-accent-coral" : "text-foreground",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
