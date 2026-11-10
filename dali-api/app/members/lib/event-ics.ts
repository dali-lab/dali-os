// Add-to-calendar file for a Community event. Pure and client-safe.

export type EventIcsInput = {
  id: string;
  title: string;
  startsAt: Date | string;
  endsAt: Date | string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
};

const escapeText = (t: string) =>
  t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const stamp = (d: Date | string) =>
  new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// RFC 5545 caps a line at 75 octets; continuation lines start with a space.
function fold(line: string): string {
  const bytes = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes.encode(current + ch).length > limit) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildEventIcs(e: EventIcsInput, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DALI OS//Community//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@community.dali-os`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(e.startsAt)}`,
    `DTEND:${stamp(e.endsAt)}`,
    `SUMMARY:${escapeText(e.title)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
