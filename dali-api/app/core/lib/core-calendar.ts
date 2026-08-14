import type { Prisma } from "~/generated/prisma/client";

/**
 * Which meetings belong on the Core hub's week calendar.
 *
 * Two ways in, deliberately: a meeting scoped to the Core system group (there
 * is no "Core" meeting scope — see app/lib/groups.ts), or any meeting a Core
 * member ticked "Core meeting" on at invite time, whatever its own scope. The
 * second is how a project or ad-hoc meeting Core needs to see reaches this
 * calendar without changing who was invited.
 *
 * `coreGroupId` is null until the Core group is seeded; the marked meetings
 * still show, so the calendar is never empty by construction.
 */
export function coreCalendarMeetingWhere(
  coreGroupId: string | null,
): Prisma.ScheduledMeetingWhereInput {
  return {
    status: { not: "Cancelled" },
    OR: [
      ...(coreGroupId ? [{ scopeType: "Group" as const, scopeId: coreGroupId }] : []),
      { isCoreMeeting: true },
    ],
  };
}
