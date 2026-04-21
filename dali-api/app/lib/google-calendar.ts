interface BusyEvent {
  start: string;
  end: string;
}

// Google Calendar integration was removed with the OAuth migration.
// To restore it, implement a separate Google OAuth flow for calendar access.
export async function fetchBusyEvents(
  _userId: string,
  _start: Date,
  _end: Date,
): Promise<BusyEvent[]> {
  return [];
}
