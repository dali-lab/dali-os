// Application-event wrapper over the generic ICS builder (app/lib/ics.ts),
// mirroring interview-ics.ts: a stable UID scheme plus a REQUEST convenience
// for the announcement email (hiring-event-notice.ts).

import { buildIcs, type IcsAttendee } from "~/lib/ics";

export type { IcsAttendee };

export interface HiringEventIcsParams {
  eventId: string;
  summary: string;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  organizer: IcsAttendee;
  attendee: IcsAttendee;
}

function uid(eventId: string): string {
  return `hiring-event-${eventId}@dali.dartmouth.edu`;
}

export function buildHiringEventIcs(params: HiringEventIcsParams): string {
  return buildIcs({
    uid: uid(params.eventId),
    method: "REQUEST",
    summary: params.summary,
    startTime: params.startTime,
    endTime: params.endTime,
    location: params.location,
    organizer: params.organizer,
    attendees: [params.attendee],
    sequence: 0,
  });
}
