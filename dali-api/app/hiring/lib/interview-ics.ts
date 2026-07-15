// Interview wrappers over the generic ICS builder (app/lib/ics.ts): the
// interview UID scheme plus REQUEST/CANCEL conveniences used by
// interview-emails.ts.

import { buildIcs, type IcsAttendee } from "~/lib/ics";

export type { IcsAttendee };

export interface IcsEventParams {
  interviewId: string;
  summary: string;
  startTime: Date;
  endTime: Date;
  location: string; // "Pod Appa, DALI Lab" / "Pod Momo, DALI Lab" / "Online"
  meetingUrl?: string | null;
  description?: string;
  organizer: IcsAttendee;
  attendees: IcsAttendee[];
  // ICS SEQUENCE for this event. Tracked persistently on
  // Interview.icsSequence and incremented before each location-change /
  // reassignment / cancel send.
  sequence: number;
}

function uid(interviewId: string): string {
  return `interview-${interviewId}@dali.dartmouth.edu`;
}

export function buildInviteIcs(params: IcsEventParams): string {
  return buildIcs({
    uid: uid(params.interviewId),
    method: "REQUEST",
    summary: params.summary,
    startTime: params.startTime,
    endTime: params.endTime,
    location: params.location,
    meetingUrl: params.meetingUrl,
    description: params.description,
    organizer: params.organizer,
    attendees: params.attendees,
    sequence: params.sequence,
  });
}

export function buildCancelIcs(
  params: Pick<IcsEventParams, "interviewId" | "summary" | "startTime" | "endTime" | "organizer" | "attendees" | "sequence">,
): string {
  return buildIcs({
    uid: uid(params.interviewId),
    method: "CANCEL",
    summary: params.summary,
    startTime: params.startTime,
    endTime: params.endTime,
    organizer: params.organizer,
    attendees: params.attendees,
    sequence: params.sequence,
  });
}
