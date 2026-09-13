// The Calendars dialog's body.
//
// One in-page column that replaces the CalendarLayerList dropdown and the
// Settings → Calendar sub-calendar toggles. It owns:
//
//   • Connected Google accounts (connect / disconnect)
//   • Per-calendar row: Main + Show on grid + Counts toward availability
//     + colour swatch, with rename/delete behind the manager sub-modal
//
// Layer visibility is NOT here any more: every layer is a row in the Events
// page's left rail, so this panel is purely about connecting and configuring
// accounts.
//
// This renders the *contents* only — the dialog shell
// (backdrop, title, close) belongs to the page that opens it, so this drops
// into the settings dialog as one section beside Classes and Working hours.
//
// Timesheet-sync intent wired below:
//   intent    = "set-timesheet-sync"
//   enabled   = "true" | "false"
//
// The server handler must look for intent === "set-timesheet-sync" and
// persist the boolean on UserAvailabilitySettings (or a new per-user col).

import { useState } from "react";
import { createPortal } from "react-dom";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import { useFetcher, useRevalidator } from "react-router";
import { CalendarDays, ChevronDown, ChevronRight, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { CalendarManagerModal } from "~/calendar/components/composer";
import { GeneralCalendarPrompt, SectionHeader } from "~/calendar/components/settings-cards";
import type { LoaderData, CalendarLinkDTO, SubCalendarDTO } from "~/calendar/lib/types";
import { perCalendarLegend, type CalendarLegendGroup } from "~/calendar/lib/layers";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CalendarsPanelProps = {
  data: LoaderData;
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  // Whether to include the "Show on grid" toggle AND the "Counts toward
  // availability" toggle on each sub-calendar row.
  showAvailabilityToggle?: boolean;
};

// ── CalendarsPanel ─────────────────────────────────────────────────────────────

export function CalendarsPanel({
  data,
  hiddenCals,
  toggleHiddenCal,
  showAvailabilityToggle = true,
}: CalendarsPanelProps) {
  const { panel, cardPad } = useOsChrome();
  const [calMgrOpen, setCalMgrOpen] = useState(false);

  const revalidator = useRevalidator();
  // The main calendar rides the same `dali_event_dest` cookie the create modal
  // already reads for its destination — marking one here is the explicit way to
  // set what that modal defaults to.
  const setMain = (dest: string) => {
    try {
      document.cookie = `dali_event_dest=${encodeURIComponent(dest)}; path=/; max-age=31536000`;
    } catch {
      /* ignore */
    }
    revalidator.revalidate();
  };

  const googleLinks = data.calendarLinks.filter((l) => l.provider === "Google");
  const calendars = perCalendarLegend(data);

  const card = cn(panel, cardPad);
  // The design's rounded action pill, one size down — these sit beside a section
  // heading and inside a card, not on a page header.
  const action = "os-btn-primary os-btn-primary--sm shrink-0";

  return (
    <div className="flex w-full flex-col gap-7">
      <section>
        <SectionHeader
          icon={CalendarDays}
          title="Google accounts"
          action={
            /* `target="_top"` — Google's auth page sends X-Frame-Options: DENY,
               so it can't render inside the workspace iframe. */
            <a href="/oauth/calendar/google/start" target="_top" rel="noopener" className={action}>
              <Plus className="h-3.5 w-3.5" /> Add account
            </a>
          }
        />

        {/* Same prompt the left rail shows, mounted here too because this dialog
            is where someone lands when they go looking for what they're missing.
            It renders nothing once the calendar is on one of their accounts, and
            nothing at all when no Google account is connected. */}
        {data.generalCalendar === "missing" && (
          <GeneralCalendarPrompt links={data.calendarLinks} />
        )}

        {googleLinks.length === 0 ? (
          <div className={cn(card, "text-sm text-muted-foreground")}>
            No accounts connected yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {googleLinks.map((link) => (
              <AccountSection
                key={link.id}
                link={link}
                calendars={calendars}
                hiddenCals={hiddenCals}
                toggleHiddenCal={toggleHiddenCal}
                showAvailabilityToggle={showAvailabilityToggle}
                defaultEventDest={data.defaultEventDest}
                setMain={setMain}
              />
            ))}

            {data.crudEnabled && (
              <button
                type="button"
                onClick={() => setCalMgrOpen(true)}
                className={cn(action, "self-start")}
              >
                <Pencil className="h-3.5 w-3.5" /> Manage calendars
              </button>
            )}
          </div>
        )}
      </section>

      {/* Portaled to <body>: this panel renders inside a dialog whose transformed
          ancestors would otherwise trap `position: fixed` and pin the sub-modal
          to the top of the panel instead of the viewport. */}
      {calMgrOpen &&
        createPortal(
          <CalendarManagerModal data={data} onClose={() => setCalMgrOpen(false)} />,
          document.body,
        )}
    </div>
  );
}

// ── AccountSection ─────────────────────────────────────────────────────────────
// One linked Google account with its sub-calendars.

function AccountSection({
  link,
  calendars,
  hiddenCals,
  toggleHiddenCal,
  showAvailabilityToggle,
  defaultEventDest,
  setMain,
}: {
  link: CalendarLinkDTO;
  calendars: CalendarLegendGroup[];
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  showAvailabilityToggle: boolean;
  defaultEventDest: string | null;
  setMain: (dest: string) => void;
}) {
  const removeFetcher = useFetcher();
  const confirmSubmit = useConfirmSubmit();
  const [open, setOpen] = useState(true); // expanded by default in the panel
  const Chevron = open ? ChevronDown : ChevronRight;

  const accountGroup = calendars.find((g) => g.account === (link.displayName ?? link.externalEmail));
  const colHead =
    "w-[4.5rem] text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Account header */}
      <div className="flex items-center justify-between bg-os-accent/10 pr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        >
          <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <GoogleIcon />
          <span className="truncate text-sm font-semibold text-foreground">
            {link.displayName ?? link.externalEmail}
          </span>
          {link.syncError && (
            <span className="shrink-0 text-[11px] text-red-600">Sync error</span>
          )}
        </button>
        <removeFetcher.Form
          method="post"
          onSubmit={confirmSubmit({
            title: `Disconnect ${link.externalEmail}?`,
            description:
              "Removes its events, availability, and any calendars you create there.",
            tone: "destructive",
            confirmLabel: "Disconnect",
          })}
        >
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <Tooltip content={`Disconnect ${link.externalEmail}`}>
            <button
              type="submit"
              aria-label={`Disconnect ${link.externalEmail}`}
              className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </removeFetcher.Form>
      </div>

      {/* Sub-calendar rows */}
      {open && (
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {link.syncError && (
            <p className="mb-1 text-[11px] text-red-600">Sync error: {link.syncError}</p>
          )}
          {link.subCalendars === null ? (
            <p className="text-xs italic text-muted-foreground">Couldn't load calendars.</p>
          ) : link.subCalendars.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No calendars found.</p>
          ) : (
            <>
              {/* Column headers. The name column is self-evident and its
                  header only crowded the three it does have to label. */}
              <div className="mb-1 flex items-center gap-2 pl-5">
                <span className="flex-1" />
                <span className={cn(colHead, "w-12")}>Main</span>
                <span className={colHead}>Show</span>
                {showAvailabilityToggle && <span className={colHead}>Availability</span>}
              </div>
              {link.subCalendars.map((cal) => (
                <SubCalendarPanelRow
                  key={cal.id}
                  linkId={link.id}
                  cal={cal}
                  hiddenCals={hiddenCals}
                  toggleHiddenCal={toggleHiddenCal}
                  showAvailabilityToggle={showAvailabilityToggle}
                  isMain={defaultEventDest === `${link.id}:${cal.id}`}
                  setMain={setMain}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── SubCalendarPanelRow ────────────────────────────────────────────────────────
// A single sub-calendar row with:
//  1. Show on grid  (localStorage hiddenCals concept, client-only)
//  2. Counts toward availability  (UserCalendarLink.subCalendarIds, server)

function SubCalendarPanelRow({
  linkId,
  cal,
  hiddenCals,
  toggleHiddenCal,
  showAvailabilityToggle,
  isMain,
  setMain,
}: {
  linkId: string;
  cal: SubCalendarDTO;
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  showAvailabilityToggle: boolean;
  isMain: boolean;
  setMain: (dest: string) => void;
}) {
  const availFetcher = useFetcher();
  const pendingEnabled = availFetcher.formData?.get("enabled");
  const availEnabled = pendingEnabled != null ? pendingEnabled === "true" : cal.enabled;
  const gridVisible = !hiddenCals.has(cal.id);
  // Only a calendar you can write to can be the main one — a read-only
  // subscription has nowhere to put a new event.
  const canBeMain = cal.writable !== false;

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
      {/* Color swatch */}
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
        style={{ backgroundColor: cal.color ?? "#9ca3af" }}
      />

      {/* Name */}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {cal.summary}
        {cal.primary && (
          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Primary
          </span>
        )}
        {cal.writable === false && (
          <span className="ml-1.5 text-[10px] text-muted-foreground">read-only</span>
        )}
      </span>

      {/* Main calendar — where an event created in dali.os is written. Radio,
          not a toggle: exactly one calendar holds it, so picking another moves
          it rather than clearing it. */}
      <div className="flex w-12 justify-center">
        {canBeMain ? (
          <button
            type="button"
            role="radio"
            aria-checked={isMain}
            aria-label={
              isMain ? `${cal.summary} is your main calendar` : `Make ${cal.summary} your main calendar`
            }
            title={
              isMain
                ? "New events are created here"
                : "Make this the calendar new events are created on"
            }
            onClick={() => setMain(`${linkId}:${cal.id}`)}
            className={cn(
              "rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40",
              isMain ? "text-os-accent" : "text-muted-foreground/40 hover:text-muted-foreground",
            )}
          >
            <Star className={cn("h-4 w-4", isMain && "fill-current")} />
          </button>
        ) : (
          <span className="text-[10px] text-muted-foreground/50">—</span>
        )}
      </div>

      {/* Show on grid toggle (localStorage, client-side) */}
      <div className="flex w-[4.5rem] justify-center">
        <button
          type="button"
          role="switch"
          aria-checked={gridVisible}
          aria-label={`${gridVisible ? "Hide" : "Show"} ${cal.summary} on grid`}
          onClick={() => toggleHiddenCal(cal.id)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40",
            gridVisible ? "bg-os-accent" : "bg-muted-foreground/30 ring-1 ring-inset ring-black/10",
          )}
        >
          <span
            className={cn(
              "pointer-events-none absolute h-4 w-4 rounded-full bg-white shadow transition-transform",
              gridVisible ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Counts toward availability toggle (server, subCalendarIds) */}
      {showAvailabilityToggle && (
        <div className="flex w-[4.5rem] justify-center">
          <button
            type="button"
            role="switch"
            aria-checked={availEnabled}
            aria-label={`${availEnabled ? "Remove" : "Include"} ${cal.summary} in availability`}
            onClick={() =>
              availFetcher.submit(
                {
                  intent: "toggle-sub-calendar",
                  linkId,
                  calendarId: cal.id,
                  enabled: String(!availEnabled),
                },
                { method: "post" },
              )
            }
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40",
              availEnabled ? "bg-os-accent" : "bg-muted-foreground/30 ring-1 ring-inset ring-black/10",
            )}
          >
            <span
              className={cn(
                "pointer-events-none absolute h-4 w-4 rounded-full bg-white shadow transition-transform",
                availEnabled ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
