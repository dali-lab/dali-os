// Phase 5 consolidated Calendars panel.
//
// One in-page panel that replaces the CalendarLayerList dropdown, the
// CalendarManagerModal quick-link, the ClassesManagerModal quick-link, the
// WorkingHoursPopover quick-link, and the Settings → Calendar sub-calendar
// toggles.  It owns:
//
//   • Connected Google accounts (connect / disconnect)
//   • Per-calendar row: Show on grid + Counts toward availability + color swatch
//     + rename/delete (Google-owned only)
//   • Working hours (opens WorkingHoursPopover)
//   • Classes (opens ClassesManagerModal)
//   • Mirror my timesheet to Google (new opt-in toggle, off by default)
//   • Layer visibility controls (same as the old CalendarLayerList)
//
// Mount point in calendar.tsx: replace the existing CalendarLayerList +
// its wrapper dropdown with a slide-in drawer or a wider panel that renders
// <CalendarsPanel ...>.  The integration agent will wire it in;  the
// component only needs the props defined here.
//
// Timesheet-sync intent wired below:
//   intent    = "set-timesheet-sync"
//   enabled   = "true" | "false"
//
// The server handler must look for intent === "set-timesheet-sync" and
// persist the boolean on UserAvailabilitySettings (or a new per-user col).

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  GraduationCap,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Toggle } from "~/components/ui/Toggle";
import { cn } from "~/lib/cn";
import {
  CalendarManagerModal,
  ClassesManagerModal,
  WorkingHoursPopover,
} from "~/calendar/components/composer";
import type { LoaderData, CalendarLinkDTO, SubCalendarDTO } from "~/calendar/lib/types";
import type { LayerVisibility } from "~/calendar/lib/layers";
import { perCalendarLegend, type CalendarLegendGroup } from "~/calendar/lib/layers";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CalendarsPanelProps = {
  data: LoaderData;
  // Layer visibility mirrors CalendarLayerList's props so the integration agent
  // can replace CalendarLayerList with CalendarsPanel cleanly.
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  // Whether to include the "Show on grid" toggle AND the "Counts toward
  // availability" toggle on each sub-calendar row.
  showAvailabilityToggle?: boolean;
  // Called when the panel itself is closed (the integration agent wires this).
  onClose?: () => void;
  // Passed through to the classes / working-hours sub-modals so they can
  // open from inside the panel.
  classesEnabled?: boolean;
  // "Mirror my timesheet to Google" current saved state.  Default = false.
  timesheetSyncEnabled?: boolean;
  // Per-role filter chips for the Logged-time layer — show/hide your logged
  // hours by paid role. The controls are hidden if these are omitted.
  roleBuckets?: { key: string; label: string; hours: number }[];
  excludedRoleKeys?: Set<string>;
  toggleRoleKey?: (key: string) => void;
};

// ── CalendarsPanel ─────────────────────────────────────────────────────────────

export function CalendarsPanel({
  data,
  layers,
  toggleLayer,
  hiddenCals,
  toggleHiddenCal,
  showAvailabilityToggle = true,
  onClose,
  classesEnabled,
  timesheetSyncEnabled = false,
  roleBuckets = [],
  excludedRoleKeys,
  toggleRoleKey,
}: CalendarsPanelProps) {
  // Sub-modal state
  const [calMgrOpen, setCalMgrOpen] = useState(false);
  const [classesOpen, setClassesOpen] = useState(false);
  const [hoursAnchor, setHoursAnchor] = useState<DOMRect | null>(null);
  const hoursButtonRef = useRef<HTMLButtonElement>(null);

  const googleLinks = data.calendarLinks.filter((l) => l.provider === "Google");
  const calendars = perCalendarLegend(data);

  const hasAnyLinked = data.calendarLinks.length > 0;

  const sectionHead = "mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <>
      {/* ── Overlay backdrop ─────────────────────────────────────────── */}
      {onClose && (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default"
          aria-hidden
          onClick={onClose}
          tabIndex={-1}
        />
      )}

      {/* ── Panel shell ──────────────────────────────────────────────── */}
      <div className="relative z-50 flex w-[22rem] flex-col gap-5 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-brand-3 max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-foreground">
            <SlidersHorizontal className="h-4 w-4" /> Calendars
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close calendars panel"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ── Section 1: Connected accounts ──────────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className={sectionHead}>
            <CalendarDays className="h-3.5 w-3.5" /> Google accounts
            <a
              href="/oauth/calendar/google/start"
              target="_top"
              rel="noopener"
              aria-label="Add Google account"
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-foreground hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> Add
            </a>
          </div>

          {googleLinks.length === 0 && (
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
              No Google accounts connected.{" "}
              <a
                href="/oauth/calendar/google/start"
                target="_top"
                rel="noopener"
                className="font-medium text-accent-teal hover:underline"
              >
                Connect one
              </a>{" "}
              to sync your events.
            </div>
          )}

          {googleLinks.map((link) => (
            <AccountSection
              key={link.id}
              link={link}
              calendars={calendars}
              hiddenCals={hiddenCals}
              toggleHiddenCal={toggleHiddenCal}
              showAvailabilityToggle={showAvailabilityToggle}
            />
          ))}

          {data.crudEnabled && hasAnyLinked && (
            <button
              type="button"
              onClick={() => setCalMgrOpen(true)}
              className="mt-0.5 inline-flex w-fit items-center gap-1.5 text-xs font-medium text-accent-teal hover:underline"
            >
              <Pencil className="h-3 w-3" /> Manage calendars (create / rename / delete)
            </button>
          )}
        </section>

        {/* ── Section 2: Layer visibility ─────────────────────────────── */}
        <section className="flex flex-col gap-1.5">
          <div className={sectionHead}>
            Layers
          </div>
          <LayerToggles
            layers={layers}
            toggleLayer={toggleLayer}
            classesEnabled={classesEnabled ?? data.classesEnabled}
            roleBuckets={roleBuckets}
            excludedRoleKeys={excludedRoleKeys}
            toggleRoleKey={toggleRoleKey}
          />
        </section>

        {/* ── Section 3: Working hours ────────────────────────────────── */}
        <section className="flex flex-col gap-1.5">
          <div className={sectionHead}>
            <Clock className="h-3.5 w-3.5" /> Working hours
          </div>
          <button
            ref={hoursButtonRef}
            type="button"
            onClick={(e) => setHoursAnchor((cur) => (cur ? null : e.currentTarget.getBoundingClientRect()))}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Edit working hours
          </button>
        </section>

        {/* ── Section 4: Classes ─────────────────────────────────────── */}
        {data.classesEnabled && (
          <section className="flex flex-col gap-1.5">
            <div className={sectionHead}>
              <GraduationCap className="h-3.5 w-3.5" /> Classes
              {data.classTerm && (
                <span className="ml-1 normal-case tracking-normal font-normal text-muted-foreground">
                  {data.classTerm.code}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setClassesOpen(true)}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
              {data.memberClasses.length > 0
                ? `Manage classes (${data.memberClasses.length})`
                : "Add your classes"}
            </button>
          </section>
        )}

        {/* ── Section 5: Timesheet mirror ─────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className={sectionHead}>
            Timesheet
          </div>
          <TimesheetSyncToggle
            data={data}
            enabled={timesheetSyncEnabled}
            googleLinks={googleLinks}
          />
        </section>
      </div>

      {/* ── Sub-modals ────────────────────────────────────────────────── */}
      {/* Portaled to <body>: the panel opens from inside the toolbar dropdown,
          whose transformed ancestors would otherwise trap `position: fixed` and
          pin these modals to the top of the panel instead of the viewport. */}
      {calMgrOpen &&
        createPortal(
          <CalendarManagerModal data={data} onClose={() => setCalMgrOpen(false)} />,
          document.body,
        )}
      {classesOpen &&
        createPortal(
          <ClassesManagerModal data={data} onClose={() => setClassesOpen(false)} />,
          document.body,
        )}
      {hoursAnchor && (
        <WorkingHoursPopover
          data={data}
          anchor={hoursAnchor}
          onClose={() => setHoursAnchor(null)}
        />
      )}
    </>
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
}: {
  link: CalendarLinkDTO;
  calendars: CalendarLegendGroup[];
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  showAvailabilityToggle: boolean;
}) {
  const removeFetcher = useFetcher();
  const [open, setOpen] = useState(true); // expanded by default in the panel
  const Chevron = open ? ChevronDown : ChevronRight;

  const accountGroup = calendars.find((g) => g.account === (link.displayName ?? link.externalEmail));

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Account header */}
      <div className="flex items-center justify-between bg-accent-teal/10 pr-2">
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
        <removeFetcher.Form method="post">
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            aria-label={`Disconnect ${link.externalEmail}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
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
              {/* Column headers */}
              <div className="mb-1 flex items-center gap-2 pl-5">
                <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Calendar
                </span>
                <span className="w-[4.5rem] text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Show
                </span>
                {showAvailabilityToggle && (
                  <span className="w-[4.5rem] text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Availability
                  </span>
                )}
              </div>
              {link.subCalendars.map((cal) => (
                <SubCalendarPanelRow
                  key={cal.id}
                  linkId={link.id}
                  cal={cal}
                  hiddenCals={hiddenCals}
                  toggleHiddenCal={toggleHiddenCal}
                  showAvailabilityToggle={showAvailabilityToggle}
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
}: {
  linkId: string;
  cal: SubCalendarDTO;
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  showAvailabilityToggle: boolean;
}) {
  const availFetcher = useFetcher();
  const pendingEnabled = availFetcher.formData?.get("enabled");
  const availEnabled = pendingEnabled != null ? pendingEnabled === "true" : cal.enabled;
  const gridVisible = !hiddenCals.has(cal.id);

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

      {/* Show on grid toggle (localStorage, client-side) */}
      <div className="flex w-[4.5rem] justify-center">
        <button
          type="button"
          role="switch"
          aria-checked={gridVisible}
          aria-label={`${gridVisible ? "Hide" : "Show"} ${cal.summary} on grid`}
          onClick={() => toggleHiddenCal(cal.id)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40",
            gridVisible ? "bg-accent-teal" : "bg-border",
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
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40",
              availEnabled ? "bg-accent-coral" : "bg-border",
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

// ── LayerToggles ───────────────────────────────────────────────────────────────
// Compact layer visibility controls — same logic as CalendarLayerList's list,
// without the per-calendar sub-rows (those live in AccountSection above).

const LAYER_SPECS: Array<{
  key: keyof LayerVisibility;
  label: string;
  swatch: string;
  hideWhenClassesOff?: boolean;
}> = [
  { key: "external", label: "Linked calendars", swatch: "bg-accent-teal" },
  { key: "logged", label: "Logged time", swatch: "bg-violet-500" },
  { key: "workingHours", label: "Working hours", swatch: "bg-gray-300" },
];

function LayerToggles({
  layers,
  toggleLayer,
  classesEnabled,
  roleBuckets = [],
  excludedRoleKeys,
  toggleRoleKey,
}: {
  layers: LayerVisibility;
  toggleLayer: (key: keyof LayerVisibility) => void;
  classesEnabled: boolean;
  roleBuckets?: { key: string; label: string; hours: number }[];
  excludedRoleKeys?: Set<string>;
  toggleRoleKey?: (key: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {LAYER_SPECS.filter((s) => !s.hideWhenClassesOff || classesEnabled).map((spec) => {
        const on = layers[spec.key];
        return (
          <li key={spec.key}>
            <button
              type="button"
              onClick={() => toggleLayer(spec.key)}
              aria-pressed={on}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span
                className={cn(
                  "grid h-4 w-4 place-items-center rounded-[4px] border transition-colors",
                  on ? cn(spec.swatch, "border-transparent") : "border-border bg-transparent",
                )}
              >
                {on && <span className="h-1.5 w-1.5 rounded-[1px] bg-white/90" />}
              </span>
              <span className={cn(on ? "text-foreground" : "text-muted-foreground")}>
                {spec.label}
              </span>
            </button>
            {/* Per-role filter chips under the Logged-time layer: click a role
                to hide/show your logged hours for it (excludedRoleKeys). */}
            {spec.key === "logged" && on && toggleRoleKey && roleBuckets.length > 0 && (
              <div className="ml-6 mt-1 flex flex-wrap gap-1">
                {roleBuckets.map((b) => {
                  const excluded = excludedRoleKeys?.has(b.key) ?? false;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => toggleRoleKey(b.key)}
                      aria-pressed={!excluded}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                        excluded
                          ? "border-border bg-transparent text-muted-foreground line-through"
                          : "border-violet-500/40 bg-violet-500/10 text-foreground",
                      )}
                    >
                      {b.label}
                      <span className="text-muted-foreground">{Math.round(b.hours * 10) / 10}h</span>
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── TimesheetSyncToggle ────────────────────────────────────────────────────────
// "Mirror my timesheet to Google" opt-in.
//
// Server intent: set-timesheet-sync
// Form fields:   intent = "set-timesheet-sync", enabled = "true" | "false"
//
// When on:  the server lazily calls getOrCreateNamedCalendar(daliLinkId,
//           "DALI Timesheet") on the user's @dali.dartmouth.edu Google link and
//           stores the flag on UserAvailabilitySettings (or equivalent).
// When no DALI link exists: shows a prompt to connect it.

function TimesheetSyncToggle({
  data,
  enabled,
  googleLinks,
}: {
  data: LoaderData;
  enabled: boolean;
  googleLinks: CalendarLinkDTO[];
}) {
  const fetcher = useFetcher();
  const pendingEnabled = fetcher.formData?.get("enabled");
  const optimisticEnabled = pendingEnabled != null ? pendingEnabled === "true" : enabled;

  // Detect whether the user has a DALI Google link (externalEmail ends in
  // @dali.dartmouth.edu).  When absent we show a link-account prompt instead
  // of silently failing when they turn the toggle on.
  const hasDaliLink = googleLinks.some((l) =>
    l.externalEmail.toLowerCase().endsWith("@dali.dartmouth.edu"),
  );

  const toggle = () => {
    const next = !optimisticEnabled;
    fetcher.submit(
      { intent: "set-timesheet-sync", enabled: String(next) },
      { method: "post" },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">Mirror my timesheet to Google</span>
          <span className="text-xs text-muted-foreground">
            When on, your logged work hours also appear on a "DALI Timesheet" calendar on your DALI
            Google account.
          </span>
        </div>
        <Toggle
          checked={optimisticEnabled}
          onChange={toggle}
          aria-label="Mirror timesheet to Google"
          disabled={fetcher.state !== "idle"}
        />
      </div>

      {optimisticEnabled && !hasDaliLink && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Connect your{" "}
          <span className="font-semibold">@dali.dartmouth.edu</span> Google account to use this
          feature.{" "}
          <a
            href="/oauth/calendar/google/start"
            target="_top"
            rel="noopener"
            className="font-semibold underline hover:text-amber-900"
          >
            Add account
          </a>
        </div>
      )}

      {optimisticEnabled && hasDaliLink && (
        <p className="text-[11px] text-muted-foreground">
          Syncing to "DALI Timesheet" on your @dali.dartmouth.edu calendar.
        </p>
      )}
    </div>
  );
}

// ── GoogleIcon ────────────────────────────────────────────────────────────────

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
