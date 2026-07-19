// Generic RFC 5545 VCALENDAR builder. Produces strings that Gmail, Outlook,
// and Apple Calendar treat as inline calendar invites when attached via the
// `ics` param on sendEmail. Feature wrappers (hiring interviews, scheduled
// meetings) own their UID schemes — the UID is what lets receiving calendars
// match a CANCEL or update to the original REQUEST.

export interface IcsAttendee {
  email: string;
  name?: string;
}

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
  // ICS SEQUENCE for this event. RFC 5545 requires updates/cancels to use a
  // value strictly greater than the previous publish for receiving calendars
  // to apply them instead of treating the new ICS as a duplicate.
  sequence: number;
  // RFC 5545 RRULE, with or without the "RRULE:" prefix (normalized like
  // google-calendar.ts does).
  recurrenceRule?: string | null;
}

function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function organizerLine(org: IcsAttendee): string {
  const cn = org.name ? `;CN=${escapeIcsText(org.name)}` : "";
  return `ORGANIZER${cn}:mailto:${org.email}`;
}

function attendeeLine(att: IcsAttendee): string {
  const cn = att.name ? `;CN=${escapeIcsText(att.name)}` : "";
  return `ATTENDEE${cn};RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${att.email}`;
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
