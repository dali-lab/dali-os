import { useFetcher } from "react-router";
import { CalendarPlus } from "lucide-react";
import type { EventBlock } from "~/calendar/lib/types";

// "Track in DALI" on the detail popover of an external event with no DALI
// meeting behind it.
//
// The lab's general calendar is authored in Google Calendar, so its events
// reach the grid as plain external events — nothing to hang a meeting note or
// an attendance roster off, which is why those events looked bare next to every
// other meeting on the same grid. This posts the `track-event-as-meeting`
// action; the revalidation that follows swaps this button for the ordinary
// Attendance link and "Add meeting notes" affordance.
//
// No modal: there is nothing to ask. Title, time and guests all come off the
// Google event, read server-side. Note filing is the existing modal's job, one
// step later, once there is a meeting to file against.

export function TrackEventButton({
  trackable,
  className,
}: {
  trackable: NonNullable<EventBlock["trackable"]>;
  className?: string;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const busy = fetcher.state !== "idle";

  return (
    <>
      <fetcher.Form method="post" action={trackable.actionPath}>
        <input type="hidden" name="intent" value="track-event-as-meeting" />
        <input type="hidden" name="eventId" value={trackable.eventId} />
        {trackable.recurringEventId && (
          <input type="hidden" name="recurringEventId" value={trackable.recurringEventId} />
        )}
        <input type="hidden" name="linkId" value={trackable.linkId} />
        <input type="hidden" name="calendarId" value={trackable.calendarId} />
        <button type="submit" disabled={busy} className={className}>
          <CalendarPlus className="h-3.5 w-3.5 text-os-grey" />
          {busy ? "Adding…" : "Track in DALI"}
        </button>
      </fetcher.Form>
      {fetcher.data?.error && (
        <p className="mt-1.5 text-xs text-red-600">{fetcher.data.error}</p>
      )}
    </>
  );
}
