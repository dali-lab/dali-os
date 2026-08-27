// Client-safe helpers for "Classes this term" — the destination string codec
// and schedule summary. Kept out of member-class.server.ts (which imports
// prisma) so the manager UI can use them without leaking server code into the
// client bundle.

import { formatMinuteOfDay, weekdayLabel } from "./dartmouth-periods";
import type { ClassDestinationDTO, ClassMeetingDTO } from "./types";

/** Where a class should be written, parsed from the add-form's destination value. */
export type ClassDestination =
  | { kind: "local" }
  | { kind: "google-dedicated"; linkId: string }
  | { kind: "google-primary"; linkId: string }
  | { kind: "google-calendar"; linkId: string; calendarId: string };

/** Encode a destination as one form value ("local",
 *  "google:<linkId>:dedicated|primary", "google:<linkId>:cal:<calendarId>"). */
export function destinationValue(d: ClassDestinationDTO | ClassDestination): string {
  switch (d.kind) {
    case "local":
      return "local";
    case "google-dedicated":
      return `google:${d.linkId}:dedicated`;
    case "google-primary":
      return `google:${d.linkId}:primary`;
    case "google-calendar":
      return `google:${d.linkId}:cal:${d.calendarId}`;
  }
}

export function parseDestination(raw: string): ClassDestination | null {
  if (raw === "local") return { kind: "local" };
  const parts = raw.split(":");
  if (parts[0] === "google" && parts[1]) {
    const linkId = parts[1];
    if (parts[2] === "dedicated") return { kind: "google-dedicated", linkId };
    if (parts[2] === "primary") return { kind: "google-primary", linkId };
    if (parts[2] === "cal" && parts[3]) return { kind: "google-calendar", linkId, calendarId: parts[3] };
  }
  return null;
}

/** "MWF 10:10 AM–11:15 AM · Th x-hr" summary for a class in the manager list. */
export function classScheduleSummary(meetings: ClassMeetingDTO[]): string {
  return meetings
    .map((m) => {
      if (m.kind === "xhour") return `${weekdayLabel(m.days)} x-hr`;
      return `${weekdayLabel(m.days)} ${formatMinuteOfDay(m.startMin)}–${formatMinuteOfDay(m.endMin)}`;
    })
    .join(" · ");
}
