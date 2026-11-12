export const CHECK_IN_GRACE_MS = 30 * 60 * 1000;

export function isManualCheckInOpen(
  { checkInOpenAt, endsAt }: { checkInOpenAt: Date | null; endsAt: Date },
  now: Date = new Date(),
  graceMs: number = CHECK_IN_GRACE_MS,
): boolean {
  return checkInOpenAt != null && now.getTime() <= endsAt.getTime() + graceMs;
}
