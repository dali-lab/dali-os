// Renders a calendar link's stored syncError as friendly, actionable copy.
// A missing-calendar-scope failure gets a "Reconnect" link (the fix); anything
// else falls back to the raw "Sync error: …" string. Shared by every surface
// that lists connected Google accounts so they stay consistent.

import { cn } from "~/lib/cn";
import {
  CALENDAR_CONNECT_URL,
  describeCalendarSyncError,
} from "~/calendar/lib/sync-error";

export function SyncErrorNotice({
  syncError,
  className,
}: {
  syncError: string | null | undefined;
  className?: string;
}) {
  const info = describeCalendarSyncError(syncError);
  if (!info) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-red-600",
        className,
      )}
    >
      <span title={info.raw}>{info.message}</span>
      {info.needsReconnect && (
        <a
          href={CALENDAR_CONNECT_URL}
          target="_top"
          rel="noopener"
          className="font-semibold underline hover:no-underline"
        >
          Reconnect
        </a>
      )}
    </div>
  );
}
