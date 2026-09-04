// Settings → Calendar — thin pointer.
//
// Full calendar management (per-calendar visibility, availability toggles,
// working hours, classes, timesheet mirror) now lives on the Calendar page
// via the consolidated CalendarsPanel.  This settings block is kept so the
// Settings tab keeps a reachable entry point and the Google-account connect
// flow is never stranded (the OAuth redirect loop requires a top-level page
// load, not an iframe, so we keep the "Add Google account" button here too).

import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { CalendarDays, ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import type { CalendarLinkDTO } from "~/lib/settings-page.server";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";

const CALENDAR_ACTION = "/settings/calendar";

export function CalendarSettingsBlock({
  calendarLinks,
}: {
  calendarLinks: CalendarLinkDTO[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* ── Pointer notice ──────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-foreground">
        <p className="mb-2 font-medium">Calendar management moved</p>
        <p className="mb-3 text-muted-foreground text-sm">
          Working hours, per-calendar visibility, availability settings, classes, and the Google
          Timesheet mirror are now on the{" "}
          <Link
            to="/calendar"
            className="inline-flex items-center gap-1 font-medium text-accent-teal hover:underline"
          >
            Calendar page
            <ExternalLink className="h-3 w-3" />
          </Link>{" "}
          — open the{" "}
          <span className="font-semibold">Calendars</span> panel from the toolbar there.
        </p>
        <a
          href="/oauth/calendar/google/start"
          target="_top"
          rel="noopener"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add Google account
        </a>
      </div>

      {/* ── Linked accounts (read-only list + disconnect) ──────────── */}
      {calendarLinks.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarDays className="h-4 w-4" /> Linked accounts
          </h3>
          <p className="text-xs text-muted-foreground">
            Disconnect an account here; connect new ones with the button above.
          </p>
          {calendarLinks.map((l) => (
            <LinkedAccountRow key={l.id} link={l} />
          ))}
        </div>
      )}

      {calendarLinks.length === 0 && (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          No external calendars connected. Click <em>Add Google account</em> above to link one.
        </div>
      )}
    </div>
  );
}

// Collapsed by default — users don't need per-sub-calendar toggles here any
// more (those live in CalendarsPanel on the Calendar page).
function LinkedAccountRow({ link }: { link: CalendarLinkDTO }) {
  const removeFetcher = useFetcher();
  const confirmSubmit = useConfirmSubmit();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="overflow-hidden rounded-md border border-border border-l-4 border-l-accent-teal bg-card">
      <div className="flex items-center justify-between bg-accent-teal/10 pr-3">
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
            <span className="shrink-0 text-[11px] text-red-700">Sync error</span>
          )}
        </button>
        <removeFetcher.Form
          method="post"
          action={CALENDAR_ACTION}
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

      {open && (
        <div className="flex flex-col gap-2 px-3 py-3">
          {link.syncError && (
            <p className="text-[11px] text-red-700">Sync error: {link.syncError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Per-calendar visibility and availability settings are now on the{" "}
            <Link to="/calendar" className="font-medium text-accent-teal hover:underline">
              Calendar page
            </Link>
            .
          </p>
          {link.subCalendars !== null && link.subCalendars.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {link.subCalendars.map((cal) => (
                <li key={cal.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: cal.color ?? "#9ca3af" }}
                  />
                  {cal.summary}
                  {cal.primary && (
                    <span className="text-[10px] uppercase tracking-wide">Primary</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
