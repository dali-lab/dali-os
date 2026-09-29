// Client-safe: kept out of ~/lib/meeting-occurrences, whose rrule import only
// resolves on the server.

/** A meeting's page opened on one occurrence — its roster and notes. */
export function meetingOccurrenceHref(meetingId: string, occurrenceStart: string): string {
  return `/calendar/meeting/${meetingId}?occurrence=${encodeURIComponent(occurrenceStart)}`;
}
