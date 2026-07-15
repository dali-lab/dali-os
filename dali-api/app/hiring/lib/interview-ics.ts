// ICS calendar invite generator for interview events.
// Produces RFC 5545 VCALENDAR strings that Gmail, Outlook, and Apple Calendar
// handle as inline calendar invites when attached via the `ics` param on sendEmail.

export interface IcsAttendee {
  email: string;
  name?: string;
}

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
  // ICS SEQUENCE for this event. RFC 5545 requires UPDATEs to use a value
  // strictly greater than the previous publish for receiving calendars to
  // recognize the update. Tracked persistently on Interview.icsSequence and
  // incremented before each location-change / reassignment / cancel send.
  sequence: number;
}

function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function uid(interviewId: string): string {
  return `interview-${interviewId}@dali.dartmouth.edu`;
}

function organizerLine(org: IcsAttendee): string {
  const cn = org.name ? `;CN=${escapeIcsText(org.name)}` : "";
  return `ORGANIZER${cn}:mailto:${org.email}`;
}

function attendeeLine(att: IcsAttendee): string {
  const cn = att.name ? `;CN=${escapeIcsText(att.name)}` : "";
  return `ATTENDEE${cn};RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${att.email}`;
}

// Generic builder — the interview wrappers below and the scheduled-meeting
// email enrichment (app/lib/scheduled-meeting.ts) share it. UID is the
// caller's: it's what lets receiving calendars match a CANCEL to the
// original REQUEST.
export interface IcsBuildParams {
  uid: string;
  method: "REQUEST" | "CANCEL";
  summary: string;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  meetingUrl?: string | null;
  description?: string;
  organizer: IcsAttendee;
  attendees: IcsAttendee[];
  sequence: number;
  // RFC 5545 RRULE, with or without the "RRULE:" prefix (normalized like
  // google-calendar.ts does).
  recurrenceRule?: string | null;
}

export function buildIcs(p: IcsBuildParams): string {
  const cancel = p.method === "CANCEL";
  const locationLine = p.location
    ? p.meetingUrl
      ? `${p.location} — ${p.meetingUrl}`
      : p.location
    : null;
  const descLines = [p.description, p.meetingUrl ? `Join: ${p.meetingUrl}` : null]
    .filter(Boolean)
    .join("\\n");
  const rrule = p.recurrenceRule
    ? p.recurrenceRule.startsWith("RRULE:")
      ? p.recurrenceRule
      : `RRULE:${p.recurrenceRule}`
    : null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DALI Lab//DALI OS//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${p.method}`,
    "BEGIN:VEVENT",
    `UID:${p.uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(p.startTime)}`,
    `DTEND:${formatIcsDate(p.endTime)}`,
    ...(rrule ? [rrule] : []),
    `SUMMARY:${escapeIcsText(p.summary)}`,
    ...(locationLine && !cancel ? [`LOCATION:${escapeIcsText(locationLine)}`] : []),
    ...(descLines && !cancel ? [`DESCRIPTION:${escapeIcsText(descLines)}`] : []),
    organizerLine(p.organizer),
    ...p.attendees.map(attendeeLine),
    `SEQUENCE:${p.sequence}`,
    cancel ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
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
