// ICS calendar invite generator for interview events.
// Produces RFC 5545 VCALENDAR strings that Gmail, Outlook, and Apple Calendar
// handle as inline calendar invites when attached via the `ics` param on sendEmail.

export interface IcsEventParams {
  interviewId: string;
  summary: string;
  startTime: Date;
  endTime: Date;
  location: string; // "Pod Appa, DALI Lab" / "Pod Momo, DALI Lab" / "Online"
  meetingUrl?: string | null;
  description?: string;
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

export function buildInviteIcs(params: IcsEventParams): string {
  const { interviewId, summary, startTime, endTime, location, meetingUrl, description } = params;

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
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}

export function buildCancelIcs(params: Pick<IcsEventParams, "interviewId" | "summary" | "startTime" | "endTime">): string {
  const { interviewId, summary, startTime, endTime } = params;

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
    "SEQUENCE:1",
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}
