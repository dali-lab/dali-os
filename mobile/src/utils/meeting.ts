import type { CalendarEvent } from '../api/contract';
import type { MeetingTarget } from '../contexts/NotesContext';

/** The DALI meeting occurrence behind a calendar event; null for interviews, classes and outside calendars. */
export function meetingTarget(event: CalendarEvent): MeetingTarget | null {
  if (!event.scheduledMeetingId || !event.occurrenceStart) return null;
  return { id: event.scheduledMeetingId, title: event.title, start: event.start, end: event.end, occurrenceStart: event.occurrenceStart };
}
