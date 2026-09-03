import { useFetcher } from "react-router";
import { useState, useId } from "react";
import {
  CalendarDays,
  Clock,
  Shield,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  RotateCcw,
  Building2,
  Wifi,
} from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { Toggle } from "~/components/ui/Toggle";
import { Tooltip } from "~/components/ui/floating";
import {
  defaultWorkingHours,
  DEFAULT_WORK_START_MIN,
  DEFAULT_WORK_END_MIN,
} from "~/calendar/lib/calendar-defaults";
import { DAY_LABELS } from "~/calendar/lib/event-block";
import type {
  WhDay,
  SubCalendarDTO,
  CalendarLinkDTO,
  LoaderData,
} from "~/calendar/lib/types";

/* ------------------------------------------------------------------ */
/* CalendarIntegrationsCard                                            */
/* ------------------------------------------------------------------ */

export function CalendarIntegrationsCard({
  links,
  ingestionError,
  generalCalendar,
}: {
  links: CalendarLinkDTO[];
  ingestionError: string | null;
  generalCalendar: LoaderData["generalCalendar"];
}) {
  const { os, card, cardPad, bodyText, heading, headingIcon, quietBtn } = useOsChrome();
  return (
    <section>
      <div className={cn("flex items-center justify-between", os ? "mb-4" : "mb-3")}>
        <h2 className={heading}>
          <CalendarDays className={headingIcon} />
          Calendar Integrations
        </h2>
        {/* `<a target="_top">` — Google's auth page sends X-Frame-Options: DENY, so
            it can't render inside the workspace iframe. Break out to the top window. */}
        <a
          href="/oauth/calendar/google/start"
          target="_top"
          rel="noopener"
          className={quietBtn}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Google Account
        </a>
      </div>
      {ingestionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-2">
          Couldn't refresh external events: {ingestionError}
        </div>
      )}
      {generalCalendar === "missing" && <GeneralCalendarPrompt links={links} />}
      {links.length > 0 && (
        <p className={cn(bodyText, "mb-3 text-xs")}>
          These control which calendars <strong>feed into DALI</strong> — their events and your
          availability. To just hide a calendar on the grid, use <strong>Calendars ▾</strong> on the
          calendar.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {links.length === 0 && (
          <div className={cn(card, cardPad, bodyText)}>No external calendars connected.</div>
        )}
        {links.map((l) => (
          <CalendarLinkBlock key={l.id} link={l} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* GeneralCalendarPrompt                                               */
/* ------------------------------------------------------------------ */

// Shown while the shared DALI General Calendar isn't on any linked Google
// account. One account → subscribe straight away; several → let the member pick
// which one it lands on.
export function GeneralCalendarPrompt({ links }: { links: CalendarLinkDTO[] }) {
  const { os } = useOsChrome();
  const fetcher = useFetcher<{ error?: string }>();
  const [picking, setPicking] = useState(false);
  const accounts = links.filter((l) => l.provider === "Google");
  if (accounts.length === 0) return null;

  const subscribe = (linkId: string) =>
    fetcher.submit({ intent: "subscribe-general-calendar", linkId }, { method: "post" });
  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  return (
    <div
      className={cn(
        "bg-os-accent/10 border border-os-accent/30 px-3 py-2.5 mb-2 flex flex-col gap-2",
        os ? "rounded-os-item" : "rounded-md",
      )}
    >
      <p className="text-xs text-foreground">Add the DALI General Calendar</p>
      {picking && accounts.length > 1 ? (
        <div className="flex flex-col gap-1">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={busy}
              onClick={() => subscribe(a.id)}
              className={cn(
                "flex items-center gap-2 border border-border bg-card px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-60",
                os ? "rounded-os-item" : "rounded-md",
              )}
            >
              <GoogleIcon />
              <span className="truncate">{a.externalEmail}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (accounts.length === 1 ? subscribe(accounts[0].id) : setPicking(true))}
          className={cn(
            "self-start inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-os-accent text-os-bg hover:bg-os-accent-hover transition-colors disabled:opacity-60",
            os ? "rounded-full" : "rounded-md",
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          {busy
            ? "Adding…"
            : accounts.length === 1
              ? `Add to ${accounts[0].externalEmail}`
              : "Add DALI calendar"}
        </button>
      )}
      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CalendarLinkBlock                                                   */
/* ------------------------------------------------------------------ */

function CalendarLinkBlock({ link }: { link: CalendarLinkDTO }) {
  const { os, card, bodyText } = useOsChrome();
  const removeFetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        "overflow-hidden",
        card,
        // The teal edge is the brand shell's source marker; under os the tinted
        // header carries that on its own and a 4px edge fights the 24px corner.
        !os && "border-l-4 border-l-accent-teal",
      )}
    >
      <div className="flex items-center justify-between bg-accent-teal/10 pr-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        >
          <Chevron className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <GoogleIcon />
          <span className="font-semibold text-sm text-foreground truncate">
            {link.displayName ?? link.externalEmail}
          </span>
          {!open && link.syncError && (
            <span className="flex-shrink-0 text-[11px] text-destructive">Sync error</span>
          )}
        </button>
        <removeFetcher.Form method="post">
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            aria-label={`Remove ${link.externalEmail}`}
            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </removeFetcher.Form>
      </div>
      {open && (
        <div id={bodyId} className="px-3 py-3 flex flex-col gap-2">
          {link.syncError && (
            <div className="text-[11px] text-destructive">Sync error: {link.syncError}</div>
          )}
          {link.subCalendars === null ? (
            <div className={cn(bodyText, "italic")}>Couldn't load this account's calendars.</div>
          ) : link.subCalendars.length === 0 ? (
            <div className={cn(bodyText, "italic")}>No calendars found.</div>
          ) : (
            link.subCalendars.map((cal) => (
              <SubCalendarRow key={cal.id} linkId={link.id} cal={cal} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GoogleIcon                                                          */
/* ------------------------------------------------------------------ */

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* SubCalendarRow                                                      */
/* ------------------------------------------------------------------ */

function SubCalendarRow({ linkId, cal }: { linkId: string; cal: SubCalendarDTO }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData;
  const enabled = pending ? pending.get("enabled") === "true" : cal.enabled;
  return (
    <button
      type="button"
      onClick={() =>
        fetcher.submit(
          {
            intent: "toggle-sub-calendar",
            linkId,
            calendarId: cal.id,
            enabled: String(!enabled),
          },
          { method: "post" },
        )
      }
      className="flex items-center justify-between text-left hover:bg-muted/50 rounded-md px-1 py-1 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: cal.color ?? "var(--os-accent)" }}
        />
        <span className="text-sm text-foreground truncate">{cal.summary}</span>
        {cal.primary && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Primary
          </span>
        )}
      </div>
      <span
        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors flex-shrink-0 ${
          enabled
            ? "bg-os-accent border-os-accent text-os-bg"
            : "border-border bg-background"
        }`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* WorkingHoursCard                                                    */
/* ------------------------------------------------------------------ */

export function WorkingHoursCard({
  workingHours,
  hasPersisted,
  hint,
}: {
  workingHours: WhDay[];
  hasPersisted: boolean;
  /** One line under the heading. The card already titles itself, so callers
   *  add context here rather than stacking a second heading above it. */
  hint?: string;
}) {
  const { os, card, cardPad, iconBtn } = useOsChrome();
  const resetFetcher = useFetcher();
  const toggleFetcher = useFetcher();

  // "On" once the user has saved any working-hours state. While a master-toggle
  // submit is in flight, reflect the in-flight intent optimistically.
  const pendingToggleIntent =
    typeof toggleFetcher.formData?.get("intent") === "string"
      ? (toggleFetcher.formData.get("intent") as string)
      : null;
  const enabled =
    pendingToggleIntent === "seed-working-hours"
      ? true
      : pendingToggleIntent === "reset-working-hours"
        ? false
        : hasPersisted;

  const turnOn = () => {
    // Persist the full Mon–Fri 9–5 default in one shot so the editor opens with
    // sensible values and every day has a real row.
    const days = defaultWorkingHours().map((d) => ({
      dayOfWeek: d.dayOfWeek,
      segments: d.segments.map((s) => ({
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        location: s.location,
      })),
    }));
    toggleFetcher.submit(
      { intent: "seed-working-hours", days: JSON.stringify(days) },
      { method: "post" },
    );
  };
  const turnOff = () =>
    toggleFetcher.submit({ intent: "reset-working-hours" }, { method: "post" });

  return (
    <section>
      <div className={cn("flex items-center justify-between", os ? "mb-4" : "mb-3")}>
        {/* Matches the Availability tab's other section headers: a muted glyph
            in the gutter and a sentence-case semibold title, rather than the
            eyebrow + accent-icon pair the older settings cards use. */}
        <div className="flex min-w-0 items-start gap-2.5">
          <Clock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Working hours</h2>
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {enabled && (
            <>
              <resetFetcher.Form
                method="post"
                onSubmit={(e) => {
                  // Re-seed the default week rather than wiping to "off" — this
                  // button resets hours, it doesn't disable the feature.
                  e.preventDefault();
                  const days = defaultWorkingHours().map((d) => ({
                    dayOfWeek: d.dayOfWeek,
                    segments: d.segments.map((s) => ({
                      startMinute: s.startMinute,
                      endMinute: s.endMinute,
                      location: s.location,
                    })),
                  }));
                  resetFetcher.submit(
                    { intent: "seed-working-hours", days: JSON.stringify(days) },
                    { method: "post" },
                  );
                }}
              >
                <Tooltip content="Reset working hours to defaults">
                  <button
                    type="submit"
                    aria-label="Reset working hours to defaults"
                    className={iconBtn}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </resetFetcher.Form>
            </>
          )}
          {/* Master on/off switch */}
          <Toggle
            checked={enabled}
            aria-label="Working hours enabled"
            onChange={() => (enabled ? turnOff() : turnOn())}
          />
        </div>
      </div>
      {enabled && (
        <div className={cn(card, cardPad, "flex flex-col gap-2")}>
          {workingHours.map((d) => (
            <DayRow key={d.dayOfWeek} day={d} allDays={workingHours} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* LocalSegment type + DayRow                                         */
/* ------------------------------------------------------------------ */

type LocalSegment = { startMinute: number; endMinute: number; location: "InPerson" | "Remote" };

function DayRow({ day, allDays }: { day: WhDay; allDays: WhDay[] }) {
  const fetcher = useFetcher();
  // Optimistic state: while a submit is pending, render the in-flight values
  // rather than the loader values so edits feel instant. We submit the whole
  // week (seed-working-hours), so pull this day's slice back out of `days`.
  const pending = fetcher.formData;
  const pendingSegments: LocalSegment[] | null = (() => {
    if (!pending) return null;
    const raw = pending.get("days");
    if (typeof raw !== "string") return null;
    try {
      const parsed = JSON.parse(raw) as {
        dayOfWeek: number;
        segments: LocalSegment[];
      }[];
      return parsed.find((d) => d.dayOfWeek === day.dayOfWeek)?.segments ?? [];
    } catch {
      return null;
    }
  })();
  const segments: LocalSegment[] =
    pendingSegments ??
    day.segments.map((s) => ({
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      location: s.location,
    }));

  const enabled = segments.length > 0;

  // Persist the whole week every time so a day that currently has no DB row
  // (e.g. an unsaved default) isn't dropped by the loader's "unlisted ⇒ empty"
  // rule. `next` replaces this day's segments; other days carry through as-is.
  const submitSegments = (next: LocalSegment[]) => {
    const days = allDays.map((d) =>
      d.dayOfWeek === day.dayOfWeek
        ? { dayOfWeek: d.dayOfWeek, segments: next }
        : {
            dayOfWeek: d.dayOfWeek,
            segments: d.segments.map((s) => ({
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              location: s.location,
            })),
          },
    );
    fetcher.submit(
      { intent: "seed-working-hours", days: JSON.stringify(days) },
      { method: "post" },
    );
  };

  const toggleEnabled = () => {
    if (enabled) submitSegments([]);
    else
      submitSegments([
        { startMinute: DEFAULT_WORK_START_MIN, endMinute: DEFAULT_WORK_END_MIN, location: "InPerson" },
      ]);
  };

  const updateSegment = (idx: number, patch: Partial<LocalSegment>) => {
    const next = segments.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    submitSegments(next);
  };

  const removeSegment = (idx: number) => {
    submitSegments(segments.filter((_, i) => i !== idx));
  };

  const addSegment = () => {
    // Default new segment to start where the last one ends (or 9am if empty).
    const last = segments[segments.length - 1];
    const start = last ? Math.min(last.endMinute, 1380) : DEFAULT_WORK_START_MIN;
    const end = Math.min(start + 60, 1440);
    submitSegments([...segments, { startMinute: start, endMinute: end, location: "InPerson" }]);
  };

  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={toggleEnabled}
        className={`mt-1.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
          enabled ? "bg-os-accent border-os-accent text-os-bg" : "border-border bg-background"
        }`}
        aria-label={`${DAY_LABELS[day.dayOfWeek]} enabled`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </button>
      <span className="mt-1 text-sm font-medium text-foreground w-9 flex-shrink-0">
        {DAY_LABELS[day.dayOfWeek]}
      </span>
      {enabled ? (
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {segments.map((seg, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <TimeField
                valueMin={seg.startMinute}
                onCommit={(min) => updateSegment(idx, { startMinute: min })}
                aria-label={`${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1} start`}
              />
              <span className="text-muted-foreground text-sm">–</span>
              <TimeField
                valueMin={seg.endMinute}
                onCommit={(min) => updateSegment(idx, { endMinute: min })}
                aria-label={`${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1} end`}
              />
              <div className="flex items-center gap-0.5 ml-auto">
                <LocButton
                  active={seg.location === "InPerson"}
                  onClick={() => updateSegment(idx, { location: "InPerson" })}
                  icon={<Building2 className="w-3.5 h-3.5" />}
                />
                <LocButton
                  active={seg.location === "Remote"}
                  onClick={() => updateSegment(idx, { location: "Remote" })}
                  icon={<Wifi className="w-3.5 h-3.5" />}
                />
              </div>
              {/* With a single segment the day checkbox already removes it
                  (un-checking clears the day), so the delete button only
                  appears when there are multiple segments to pick from. */}
              {segments.length > 1 && (
                <Tooltip content="Remove segment">
                  <button
                    type="button"
                    onClick={() => removeSegment(idx)}
                    aria-label={`Remove ${DAY_LABELS[day.dayOfWeek]} segment ${idx + 1}`}
                    className="p-1 mr-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addSegment}
            className="self-start inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            <Plus className="w-3 h-3" /> Add segment
          </button>
        </div>
      ) : (
        <span className="mt-1 text-sm text-muted-foreground italic ml-1">Unavailable</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TimeField (local — minOfDay segment time input)                    */
/* ------------------------------------------------------------------ */

function TimeField({
  valueMin,
  onCommit,
  ...rest
}: { valueMin: number; onCommit: (min: number) => void } & React.AriaAttributes) {
  const { os, compactField } = useOsChrome();
  const [text, setText] = useState(formatTime(valueMin));
  // Keep text in sync if the canonical value changes externally (e.g. after submit).
  // Using a key on the parent would be cleaner, but a defaultValue + onBlur commit
  // is enough for this UI.
  return (
    <div className="relative">
      <input
        {...rest}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseTime(text);
          if (parsed === null || parsed === valueMin) {
            setText(formatTime(valueMin));
            return;
          }
          onCommit(parsed);
        }}
        className={cn(
          "w-[88px] pl-2 pr-6 py-1 text-xs border border-border focus:outline-none",
          compactField,
          !os && "focus:ring-2 focus:ring-os-accent/30",
        )}
      />
      <Clock className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* formatTime / parseTime                                              */
/* ------------------------------------------------------------------ */

function formatTime(minOfDay: number): string {
  const h = Math.floor(minOfDay / 60);
  const m = minOfDay % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

function parseTime(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  const period = m[3]?.toUpperCase();
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/* ------------------------------------------------------------------ */
/* LocButton                                                           */
/* ------------------------------------------------------------------ */

function LocButton({ active, onClick, icon }: { active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active ? "bg-os-accent/20 text-os-accent" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* EventBuffersCard                                                    */
/* ------------------------------------------------------------------ */

export function EventBuffersCard({ bufferMin }: { bufferMin: number }) {
  const { os, card, cardPad, heading, headingIcon } = useOsChrome();
  const fetcher = useFetcher();
  const pending = fetcher.formData;
  const selectedMin = pending ? Number(pending.get("defaultEventBufferMin")) : bufferMin;
  const options: { label: string; value: number }[] = [
    { label: "None", value: 0 },
    { label: "5m", value: 5 },
    { label: "10m", value: 10 },
    { label: "15m", value: 15 },
    { label: "30m", value: 30 }
  ];
  return (
    <section>
      <h2 className={cn(heading, os ? "mb-4" : "mb-3")}>
        <Shield className={headingIcon} />
        Event Buffers
      </h2>
      <div className={cn(card, cardPad)}>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              // The fill is the only thing that says which buffer is on now
              // that the sentence under the row is gone.
              aria-pressed={selectedMin === o.value}
              onClick={() =>
                fetcher.submit(
                  { intent: "set-event-buffer", defaultEventBufferMin: String(o.value) },
                  { method: "post" },
                )
              }
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition-colors",
                os ? "rounded-full" : "rounded-md",
                selectedMin === o.value
                  ? // The os design marks a chosen segment with the container
                    // fill, as the People directory's Active/Alumni switch does.
                    os
                    ? "bg-os-container text-foreground"
                    : "bg-os-accent text-os-bg"
                  : os
                    ? "bg-os-well text-os-grey hover:text-foreground"
                    : "bg-background text-foreground border border-border hover:bg-muted",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

