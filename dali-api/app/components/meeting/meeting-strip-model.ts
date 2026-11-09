import { formatInTimeZone, APPLICATION_TZ } from "~/lib/timezone";

export type MeetingStripSource = {
  startIso: string;
  location: string | null;
  roomNames: string[];
};

export function meetingTimeLabel(startIso: string): string {
  const day = formatInTimeZone(startIso, APPLICATION_TZ, { weekday: "short", month: "short", day: "numeric" });
  const time = formatInTimeZone(startIso, APPLICATION_TZ, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

export function meetingPlaceLabel({ location, roomNames }: Pick<MeetingStripSource, "location" | "roomNames">): string | null {
  if (roomNames.length > 0) return roomNames.join(", ");
  return location?.trim() || null;
}

export function attendanceLabel(rows: { present: boolean }[]): string {
  return `${rows.filter((r) => r.present).length} of ${rows.length}`;
}

export function meetingSubtitle({
  startIso,
  place,
  recordedMinutes,
}: {
  startIso: string;
  place: string | null;
  recordedMinutes: number | null;
}): string {
  const tail = recordedMinutes !== null ? `Recorded ${recordedMinutes} min` : place;
  return [meetingTimeLabel(startIso), tail].filter(Boolean).join(" · ");
}
