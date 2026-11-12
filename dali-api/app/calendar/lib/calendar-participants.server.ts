import { prisma } from "~/lib/db.server";
import { listAllGroups } from "~/lib/groups";
import { listMentorPairs } from "~/mentorship/lib/pair-suggestion.server";
import { currentTermMemberWhere } from "~/lib/roles";
import { listCalendarsForLink } from "~/lib/google-calendar";
import type { CalendarLinkDTO, GroupOption, MentorPairOption, SubCalendarDTO, UserOption } from "~/calendar/lib/types";

// Pure mapping from a UserCalendarLink row + its prefetched Google calendar
// list to the display DTO (subCalendars with writable/enabled flags). No I/O —
// callers fetch the token + calendar list themselves (loadCalendarData dedups
// that fetch with its external-events read; loadSchedulingData does its own).
// Extracted so both loaders build the exact same shape for CreateEventModal's
// event/invite destination pickers.
export async function buildCalendarLinkDTO(
  l: {
    id: string;
    provider: "Google" | "Outlook";
    externalEmail: string;
    displayName: string | null;
    enabled: boolean;
    primary: boolean;
    syncError: string | null;
    subCalendarIds: string[];
  },
  prefetchedCalendarLists: Map<string, Awaited<ReturnType<typeof listCalendarsForLink>> | undefined>,
  timesheetCalendarId: string | null,
): Promise<CalendarLinkDTO> {
  const base = {
    id: l.id,
    provider: l.provider,
    externalEmail: l.externalEmail,
    displayName: l.displayName,
    enabled: l.enabled,
    primary: l.primary,
    syncError: l.syncError,
  };
  if (l.provider !== "Google") {
    return { ...base, subCalendars: null };
  }
  // Use the pre-fetched list rather than making another HTTP call.
  const items = prefetchedCalendarLists.get(l.id);
  if (!items) {
    return { ...base, subCalendars: null };
  }
  const enabledSet = new Set(l.subCalendarIds);
  // When subCalendarIds is empty, treat the primary as the only one in use.
  const subCalendars: SubCalendarDTO[] = items
    // The DALI Timesheet calendar is a Google-side mirror of logged hours;
    // DALI shows those natively in the logged-time layer, so it never
    // appears as a linked calendar here (hidden even for users who had it
    // auto-subscribed before this became a mirror-only calendar).
    .filter((it) => it.id !== timesheetCalendarId)
    .map((it) => ({
      id: it.id,
      summary: it.summary,
      primary: it.primary === true,
      color: it.backgroundColor ?? null,
      enabled: l.subCalendarIds.length === 0 ? it.primary === true : enabledSet.has(it.id),
      writable: it.accessRole === "owner" || it.accessRole === "writer",
    }));
  return { ...base, subCalendars };
}

// Members + groups for a participant picker: current lab members (no applicants,
// partners, or non-active alumni) plus every non-archived group. Group rosters
// can name members outside the current-term set (alumni, inactive), so display
// names for those are fetched and merged in — otherwise the picker renders a raw
// user id. Shared by the calendar loader and the meeting edit-context endpoint.
export async function loadParticipantOptions(
  request: Request,
  viewerId: string,
): Promise<{ groups: GroupOption[]; users: UserOption[]; mentorPairs: MentorPairOption[] }> {
  const memberWhere = await currentTermMemberWhere(request);
  const [groups, users, mentorPairs] = await Promise.all([
    listAllGroups().then((rows) =>
      rows
        .filter((r) => !r.archived)
        .map((r) => ({
          id: r.id,
          name: r.name,
          memberIds: r.memberIds,
          projectId: r.dynamicQuery?.startsWith("project:")
            ? r.dynamicQuery.slice("project:".length)
            : null,
          systemKey: r.systemKey ?? null,
        })),
    ),
    prisma.user.findMany({
      where: memberWhere,
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    listMentorPairs(viewerId, request),
  ]);
  const knownUserIds = new Set(users.map((u) => u.id));
  const missingMemberIds = Array.from(
    new Set(groups.flatMap((g) => g.memberIds).filter((id) => !knownUserIds.has(id))),
  );
  const extraGroupMembers = missingMemberIds.length
    ? await prisma.user.findMany({
        where: { id: { in: missingMemberIds } },
        select: { id: true, firstName: true, lastName: true, daliEmail: true },
      })
    : [];
  return { groups, users: [...users, ...extraGroupMembers], mentorPairs };
}
