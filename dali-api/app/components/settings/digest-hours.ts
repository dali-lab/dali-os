// The hours a member can pick for their digests, always including the lab
// default (Admin → Jobs) so picking it again follows later admin changes.
export const DIGEST_HOUR_CHOICES = [8, 12, 18] as const;

export function digestHourOptions(defaultHour: number): number[] {
  return [...new Set([defaultHour, ...DIGEST_HOUR_CHOICES])].sort((a, b) => a - b);
}

export function digestHourLabel(hour: number): string {
  if (hour === 0) return "Midnight";
  if (hour === 12) return "Noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** What to store for a pick: null when it is the lab default. */
export function digestHourToStore(hour: number, defaultHour: number): number | null {
  return hour === defaultHour ? null : hour;
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
