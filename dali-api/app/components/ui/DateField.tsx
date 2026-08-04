import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "~/lib/cn";

// Custom date / datetime / time picker — a drop-in for the native inputs of the
// same `type`, styled to match the app (trigger + portal calendar popover, like
// SelectMenu). It manipulates the LITERAL wall-clock STRING only ("yyyy-MM-dd",
// "yyyy-MM-ddThh:mm", "HH:mm") — it never converts the value to/from a Date
// instant — so it is byte-identical to the native input for every caller and
// carries no timezone semantics of its own. (Date.UTC is used only for pure
// calendar-grid math: how many days are in a month, and which weekday day 1 is.)
//
// Controlled: pass `value` + `onChange`. Form: pass `name` (+ optional
// `defaultValue`) and a hidden native <input type={mode}> mirrors the value.

export type DateFieldMode = "date" | "datetime-local" | "time";

export interface DateFieldProps {
  mode: DateFieldMode;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(mode: DateFieldMode, v: string | undefined) {
  // Returns {y,m,d,hh,mm} (m is 0-based) or null when unset/malformed.
  if (!v) return null;
  if (mode === "time") {
    const t = /^(\d{2}):(\d{2})/.exec(v);
    return t ? { y: 0, m: 0, d: 0, hh: +t[1]!, mm: +t[2]! } : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!match) return null;
  return {
    y: +match[1]!, m: +match[2]! - 1, d: +match[3]!,
    hh: match[4] ? +match[4] : 0, mm: match[5] ? +match[5] : 0,
  };
}

function build(mode: DateFieldMode, p: { y: number; m: number; d: number; hh: number; mm: number }) {
  const date = `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
  const time = `${pad(p.hh)}:${pad(p.mm)}`;
  if (mode === "time") return time;
  if (mode === "date") return date;
  return `${date}T${time}`;
}

function formatDisplay(mode: DateFieldMode, v: string | undefined): string | null {
  const p = parts(mode, v);
  if (!p) return null;
  const time = `${p.hh % 12 === 0 ? 12 : p.hh % 12}:${pad(p.mm)} ${p.hh >= 12 ? "PM" : "AM"}`;
  if (mode === "time") return time;
  // UTC-pinned so the label never shifts by a timezone.
  const label = new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(p.y, p.m, p.d)));
  return mode === "date" ? label : `${label} · ${time}`;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const firstWeekday = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).getUTCDay();
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
// Parse a typed hour/minute field, clamping to [0, max]; empty/garbage → 0.
const clampInt = (raw: string, max: number) => {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : Math.min(max, Math.max(0, n));
};
// 24h ↔ 12h + meridiem. Storage stays 24h; the US-style UI shows 1-12 + AM/PM.
const to12 = (hh24: number) => (hh24 % 12 === 0 ? 12 : hh24 % 12);
const from12 = (h12: number, pm: boolean) => (h12 % 12) + (pm ? 12 : 0);

export function DateField({
  mode,
  value,
  defaultValue,
  onChange,
  name,
  min,
  max,
  required = false,
  disabled = false,
  placeholder,
  className,
  ariaLabel,
}: DateFieldProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = isControlled ? value : internal;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);

  const cur = parts(mode, current);
  const today = new Date();
  const [viewY, setViewY] = useState(cur?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState(cur?.m ?? today.getMonth());

  useEffect(() => {
    // Re-centre the visible month on the selected value when the popover opens.
    if (open && cur) {
      setViewY(cur.y);
      setViewM(cur.m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function emit(next: string) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  function pickDay(y: number, m: number, d: number) {
    emit(build(mode, { y, m, d, hh: cur?.hh ?? 0, mm: cur?.mm ?? 0 }));
    if (mode === "date") setOpen(false);
  }
  function setTime(hh: number, mm: number) {
    const base = cur ?? { y: today.getFullYear(), m: today.getMonth(), d: today.getDate(), hh: 0, mm: 0 };
    emit(build(mode, { ...base, hh, mm }));
  }

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const minWidth = Math.max(r.width, 260);
    const left = Math.min(r.left, window.innerWidth - minWidth - 8);
    const top = r.bottom + 4;
    setPos({ top, left, minWidth });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Keep the calendar pinned to the trigger while scrolling (e.g. inside a
    // scrollable dialog) rather than closing it.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  const minKey = min && parts(mode, min) ? min.slice(0, 10) : null;
  const maxKey = max && parts(mode, max) ? max.slice(0, 10) : null;
  const outOfRange = (k: string) => (minKey && k < minKey) || (maxKey && k > maxKey);


  const display = formatDisplay(mode, current);
  const showCalendar = mode !== "time";
  const showTime = mode !== "date";

  const leadingBlanks = showCalendar ? firstWeekday(viewY, viewM) : 0;
  const dayCount = showCalendar ? daysInMonth(viewY, viewM) : 0;

  return (
    <span className={cn("inline-block", className)}>
      {name && (
        <input
          type={mode}
          name={name}
          value={current}
          onChange={(e) => emit(e.target.value)}
          required={required}
          disabled={disabled}
          min={min}
          max={max}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className={cn("truncate", display ? "" : "text-muted-foreground")}>
          {display ?? placeholder ?? (mode === "time" ? "Pick a time" : "Pick a date")}
        </span>
        {mode === "time" ? (
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.minWidth }}
            className="z-[60] rounded-lg border border-border bg-card p-3 shadow-brand-2"
          >
            {showCalendar && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => {
                      const m = viewM - 1;
                      if (m < 0) { setViewM(11); setViewY(viewY - 1); } else setViewM(m);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-medium text-foreground">
                    {MONTHS[viewM]} {viewY}
                  </span>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => {
                      const m = viewM + 1;
                      if (m > 11) { setViewM(0); setViewY(viewY + 1); } else setViewM(m);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {WEEKDAYS.map((w, i) => (
                    <span key={i} className="py-1 text-[11px] font-medium text-muted-foreground">
                      {w}
                    </span>
                  ))}
                  {Array.from({ length: leadingBlanks }, (_, i) => (
                    <span key={`b${i}`} />
                  ))}
                  {Array.from({ length: dayCount }, (_, i) => {
                    const d = i + 1;
                    const k = dateKey(viewY, viewM, d);
                    const selected = cur && cur.y === viewY && cur.m === viewM && cur.d === d;
                    const disabledDay = !!outOfRange(k);
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={disabledDay}
                        onClick={() => pickDay(viewY, viewM, d)}
                        className={cn(
                          "aspect-square rounded text-sm transition-colors",
                          selected
                            ? "bg-accent-coral text-white"
                            : "text-foreground hover:bg-muted",
                          disabledDay && "cursor-not-allowed opacity-30 hover:bg-transparent",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {showTime && (
              <div className={cn("flex items-center gap-2", showCalendar && "mt-3 border-t border-border pt-3")}>
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={12}
                  aria-label="Hour"
                  value={to12(cur?.hh ?? 0)}
                  onChange={(e) =>
                    setTime(from12(clampInt(e.target.value, 12) || 12, (cur?.hh ?? 0) >= 12), cur?.mm ?? 0)
                  }
                  className="w-12 rounded-md border border-border bg-background px-1.5 py-1 text-center text-sm tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
                />
                <span className="text-muted-foreground">:</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  aria-label="Minute"
                  value={cur?.mm ?? 0}
                  onChange={(e) => setTime(cur?.hh ?? 0, clampInt(e.target.value, 59))}
                  className="w-12 rounded-md border border-border bg-background px-1.5 py-1 text-center text-sm tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
                />
                <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="AM/PM">
                  {([["AM", false], ["PM", true]] as const).map(([label, pm]) => {
                    const active = ((cur?.hh ?? 0) >= 12) === pm;
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setTime(((cur?.hh ?? 0) % 12) + (pm ? 12 : 0), cur?.mm ?? 0)}
                        className={cn(
                          "px-2 py-1 text-xs font-medium transition-colors",
                          active ? "bg-accent-coral text-white" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {mode === "datetime-local" && (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="ml-auto rounded-md bg-accent-coral px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-coral-light"
                  >
                    Done
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
