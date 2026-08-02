import { useId, useState } from "react";
import { Link, useFetcher } from "react-router";
import { CalendarDays, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { CalendarLinkDTO } from "~/lib/settings-page.server";

const CALENDAR_ACTION = "/settings/calendar";

export function CalendarSettingsBlock({
  calendarLinks,
}: {
  calendarLinks: CalendarLinkDTO[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Working hours, event buffers, and manual blocks live on the{" "}
          <Link to="/calendar" className="text-accent-teal hover:underline">
            Calendar page
          </Link>{" "}
          next to the availability grid.{" "}
          <Link to="/help/calendar" className="text-accent-teal hover:underline">
            How calendar sync works
          </Link>
          .
        </p>
        <a
          href="/oauth/calendar/google/start"
          target="_top"
          rel="noopener"
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add Google account
        </a>
      </div>
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarDays className="h-4 w-4" /> Linked accounts
      </h3>
      <div className="flex flex-col gap-3">
        {calendarLinks.length === 0 && (
          <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            No external calendars connected. Click <em>Add Google account</em> to link one.
          </div>
        )}
        {calendarLinks.map((l) => (
          <CalendarLinkBlock key={l.id} link={l} />
        ))}
      </div>
    </div>
  );
}

// Collapsed by default: an account's sub-calendar list is only interesting
// while you're actually changing what blocks your availability, and someone
// with several linked accounts otherwise scrolls past dozens of rows to find
// the address they came for.
function CalendarLinkBlock({ link }: { link: CalendarLinkDTO }) {
  const removeFetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="overflow-hidden rounded-md border border-border border-l-4 border-l-teal-500 bg-card">
      <div className="flex items-center justify-between bg-teal-500/10 pr-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        >
          <Chevron className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <GoogleIcon />
          <span className="truncate text-sm font-semibold text-foreground">
            {link.displayName ?? link.externalEmail}
          </span>
          {!open && link.syncError && (
            <span className="flex-shrink-0 text-[11px] text-red-700">Sync error</span>
          )}
        </button>
        <removeFetcher.Form method="post" action={CALENDAR_ACTION}>
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            aria-label={`Remove ${link.externalEmail}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </removeFetcher.Form>
      </div>
      {open && (
        <div id={bodyId} className="flex flex-col gap-2 px-3 py-3">
          {link.syncError && (
            <div className="text-[11px] text-red-700">Sync error: {link.syncError}</div>
          )}
          <p className="text-xs text-muted-foreground">
            Select which calendars should block your availability:
          </p>
          {link.subCalendars === null ? (
            <div className="text-xs italic text-muted-foreground">
              Couldn't load this account's calendars.
            </div>
          ) : link.subCalendars.length === 0 ? (
            <div className="text-xs italic text-muted-foreground">No calendars found.</div>
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

function SubCalendarRow({
  linkId,
  cal,
}: {
  linkId: string;
  cal: NonNullable<CalendarLinkDTO["subCalendars"]>[number];
}) {
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
          { method: "post", action: CALENDAR_ACTION },
        )
      }
      className="flex items-center justify-between rounded-md px-1 py-1 text-left transition-colors hover:bg-muted"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: cal.color ?? "#9ca3af" }}
        />
        <span className="truncate text-sm text-foreground">{cal.summary}</span>
        {cal.primary && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Primary
          </span>
        )}
      </div>
      <span
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors ${
          enabled
            ? "border-teal-600 bg-teal-600 text-white"
            : "border-border bg-card"
        }`}
      >
        {enabled && (
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
