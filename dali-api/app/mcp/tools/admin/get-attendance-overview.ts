// MCP `get_attendance_overview` — cross-meeting admin attendance grid. This is
// the surviving home of the cross-meeting Core view (the old /admin/attendance
// overview page was retired for the lab-wide /attendance surface). mcp:admin,
// Core leads only.

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";
import { offsetPage, offsetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 100, maxLimit: 200 };

type AttendeeRow = {
  occurrenceStart: Date;
  present: boolean;
  markedAt: Date | null;
  user: { id: string; firstName: string; lastName: string; daliEmail: string | null };
};

export const GET_ATTENDANCE_OVERVIEW_TOOL = {
  name: "get_attendance_overview",
  description:
    "Admin view of self check-in attendance across all meetings, with optional term filter. " +
    "Returns meetings newest first (undated meetings last) with per-meeting invited/checkedIn counts and, by default, attendee lists. " +
    "Pass includeAttendees false for counts only. Pass page.nextCursor as cursor to read the next page until page.hasMore is false; page.total is the number of matching meetings. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: {
        type: "string",
        description: "Filter to a specific term. Omit for all terms.",
      },
      includeAttendees: {
        type: "boolean",
        description: "Include each meeting's attendee rows. Default true. False returns only the invited and checkedIn counts.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = PageArgs & { termId?: string; includeAttendees?: boolean };

export async function runGetAttendanceOverview(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view attendance.");
  }

  let dateWhere: { gte?: Date; lte?: Date } | undefined;
  if (args.termId) {
    const term = await prisma.term.findUnique({
      where: { id: args.termId },
      select: { startDate: true, endDate: true },
    });
    if (term) dateWhere = { gte: term.startDate, lte: term.endDate };
  }

  const includeAttendees = args.includeAttendees !== false;
  const where = {
    attendanceMode: "SelfCheckIn" as const,
    status: { not: "Cancelled" as const },
    ...(dateWhere ? { selectedAt: dateWhere } : {}),
  };
  const window = offsetWindow(args, PAGE_LIMITS);
  const [fetched, total] = await Promise.all([
    prisma.scheduledMeeting.findMany({
    where,
    orderBy: [
      { selectedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "asc" },
    ],
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      title: true,
      selectedAt: true,
      meetingType: true,
      meetingTypeLabel: true,
      project: { select: { id: true, name: true } },
      organizer: { select: { firstName: true, lastName: true, daliEmail: true } },
      attendance: includeAttendees
        ? {
            orderBy: [{ occurrenceStart: "asc" }, { user: { lastName: "asc" } }],
            select: {
              occurrenceStart: true,
              present: true,
              markedAt: true,
              user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
            },
          }
        : { select: { present: true } },
    },
    }),
    prisma.scheduledMeeting.count({ where }),
  ]);
  const { rows: meetings, page } = offsetPage(fetched, window, total);

  const events = meetings.map((m) => {
    const invited = m.attendance.length;
    const checkedIn = m.attendance.filter((a) => a.present).length;
    const typeLabel =
      m.meetingType === "Other"
        ? m.meetingTypeLabel || "Other"
        : (m.meetingType ?? "Meeting");
    return {
      id: m.id,
      title: m.title,
      typeLabel,
      startsAt: m.selectedAt?.toISOString() ?? null,
      projectName: m.project?.name ?? null,
      projectId: m.project?.id ?? null,
      organizerName: m.organizer
        ? ((m.organizer.firstName ?? "") + " " + (m.organizer.lastName ?? "")).trim() ||
          m.organizer.daliEmail ||
          "—"
        : "—",
      invited,
      checkedIn,
      checkInRate: invited > 0 ? Math.round((checkedIn / invited) * 100) : null,
      ...(includeAttendees
        ? {
            attendees: (m.attendance as AttendeeRow[]).map((a) => ({
              id: a.user.id,
              name:
                ((a.user.firstName ?? "") + " " + (a.user.lastName ?? "")).trim() ||
                a.user.daliEmail ||
                a.user.id,
              // A recurring meeting has a roster per occurrence, so one person can
              // appear once per occurrence.
              occurrenceStart: a.occurrenceStart.toISOString(),
              present: a.present,
              markedAt: a.markedAt?.toISOString() ?? null,
            })),
          }
        : {}),
    };
  });

  return {
    termId: args.termId ?? null,
    page,
    events,
  };
}
