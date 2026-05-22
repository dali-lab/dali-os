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

export function buildInviteIcs(params: IcsEventParams): string {
  const { interviewId, summary, startTime, endTime, location, meetingUrl, description, organizer, attendees, sequence } = params;

  const locationLine = meetingUrl ? `${location} — ${meetingUrl}` : location;
  const descLines = [description, meetingUrl ? `Join: ${meetingUrl}` : null].filter(Boolean).join("\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DALI Lab//DALI OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid(interviewId)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startTime)}`,
    `DTEND:${formatIcsDate(endTime)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `LOCATION:${escapeIcsText(locationLine)}`,
    ...(descLines ? [`DESCRIPTION:${escapeIcsText(descLines)}`] : []),
    organizerLine(organizer),
    ...attendees.map(attendeeLine),
    `SEQUENCE:${sequence}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}

export function buildCancelIcs(
  params: Pick<IcsEventParams, "interviewId" | "summary" | "startTime" | "endTime" | "organizer" | "attendees" | "sequence">,
): string {
  const { interviewId, summary, startTime, endTime, organizer, attendees, sequence } = params;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DALI Lab//DALI OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:CANCEL",
    "BEGIN:VEVENT",
    `UID:${uid(interviewId)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startTime)}`,
    `DTEND:${formatIcsDate(endTime)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    organizerLine(organizer),
    ...attendees.map(attendeeLine),
    `SEQUENCE:${sequence}`,
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}
