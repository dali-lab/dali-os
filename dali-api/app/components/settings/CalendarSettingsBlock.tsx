import { useState } from "react";
import { useFetcher } from "react-router";
import { AlertTriangle, ChevronDown, Plus } from "lucide-react";
import type { CalendarLinkDTO } from "~/lib/settings-page.server";
import { cn } from "~/lib/cn";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { pendingForm, useFetcherErrorToast } from "~/calendar/lib/fetcher-pending";
import { CALENDAR_CONNECT_URL, describeCalendarSyncError } from "~/calendar/lib/sync-error";
import {
  SettingsEmptyRow,
  settingsDangerBtn,
  settingsList,
} from "~/components/settings/SettingsSection";

const CALENDAR_ACTION = "/settings/calendar";

/** The section's "+ Google account" control. Google's sign-in can't render in
 *  the workspace iframe, so it opens in the top window. */
export function AddGoogleAccountButton() {
  return (
    <a href={CALENDAR_CONNECT_URL} target="_top" rel="noopener" className="os-add-btn">
      <Plus className="h-4 w-4" strokeWidth={3} aria-hidden /> Google account
    </a>
  );
}

export function CalendarSettingsBlock({ calendarLinks }: { calendarLinks: CalendarLinkDTO[] }) {
  return (
    <ul className={settingsList}>
      {calendarLinks.map((l) => (
        <LinkedAccountRow key={l.id} link={l} />
      ))}
      {calendarLinks.length === 0 && <SettingsEmptyRow>No calendar accounts connected.</SettingsEmptyRow>}
    </ul>
  );
}

function LinkedAccountRow({ link }: { link: CalendarLinkDTO }) {
  const { actionBtn, actionBtnPrimary } = useOsChrome();
  const removeFetcher = useFetcher<{ error?: string } | null>();
  useFetcherErrorToast(removeFetcher);
  const confirmSubmit = useConfirmSubmit();
  const [open, setOpen] = useState(false);
  if (pendingForm(removeFetcher)) return null;

  const syncError = describeCalendarSyncError(link.syncError);
  const calendars = link.subCalendars ?? [];

  return (
    <li>
      <div className="flex flex-wrap items-center gap-4 px-6 py-4">
        <ProviderMark provider={link.provider} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
            {link.displayName ?? link.externalEmail}
            {syncError ? <Pill dot="warning">Not syncing</Pill> : <Pill dot="success">Syncing</Pill>}
          </p>
          <p className="truncate text-sm text-os-grey">{link.externalEmail}</p>
        </div>
        {syncError?.needsReconnect ? (
          <a href={CALENDAR_CONNECT_URL} target="_top" rel="noopener" className={actionBtnPrimary}>
            Reconnect
          </a>
        ) : (
          calendars.length > 0 && (
            <button
              type="button"
              className={actionBtn()}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {calendars.length} {calendars.length === 1 ? "calendar" : "calendars"}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform duration-200 ease-out", open && "rotate-180")}
                aria-hidden
              />
            </button>
          )
        )}
        <removeFetcher.Form
          method="post"
          action={CALENDAR_ACTION}
          onSubmit={confirmSubmit({
            title: `Disconnect ${link.externalEmail}?`,
            description: "Its calendars stop syncing and leave Calendar. You can reconnect any time.",
            tone: "destructive",
            confirmLabel: "Disconnect",
          })}
        >
          <input type="hidden" name="intent" value="remove-calendar-link" />
          <input type="hidden" name="linkId" value={link.id} />
          <button type="submit" className={settingsDangerBtn}>
            Disconnect
          </button>
        </removeFetcher.Form>
      </div>
      {syncError && (
        <p
          className="mx-6 mb-4 flex items-center gap-2 rounded-lg bg-os-amber/10 px-3 py-2 text-sm text-os-amber"
          title={syncError.raw}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {syncError.message}
        </p>
      )}
      {open && (
        <ul className="mx-6 mb-4 flex flex-wrap gap-2">
          {calendars.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-full bg-os-well px-3 py-1 text-sm text-os-grey"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: c.color ?? "var(--color-os-grey)" }}
                aria-hidden
              />
              {c.summary}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ProviderMark({ provider }: { provider: CalendarLinkDTO["provider"] }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white font-bold",
        provider === "Google" ? "text-[#4285F4]" : "text-[#0078D4]",
      )}
      aria-hidden
    >
      {provider === "Google" ? "G" : "O"}
    </span>
  );
}
