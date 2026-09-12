// MCP `get_attendance_overview` — cross-meeting admin attendance grid.
// Reuses admin.attendance.tsx loader query. mcp:admin, Core leads only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const GET_ATTENDANCE_OVERVIEW_TOOL = {
  name: "get_attendance_overview",
  description:
    "Admin view of self check-in attendance across all meetings, with optional term filter. " +
    "Returns up to 100 meetings with per-meeting invited/checkedIn counts and attendee lists. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: {
        type: "string",
        description: "Filter to a specific term. Omit for all terms.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { termId?: string };

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

  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      attendanceMode: "SelfCheckIn",
      status: { not: "Cancelled" },
      ...(dateWhere ? { selectedAt: dateWhere } : {}),
    },
    orderBy: [{ selectedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      selectedAt: true,
      meetingType: true,
      meetingTypeLabel: true,
      project: { select: { id: true, name: true } },
      organizer: { select: { firstName: true, lastName: true, daliEmail: true } },
      attendance: {
        orderBy: { user: { lastName: "asc" } },
        select: {
          present: true,
          markedAt: true,
          user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
        },
      },
    },
  });

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
      attendees: m.attendance.map((a) => ({
        id: a.user.id,
        name:
          ((a.user.firstName ?? "") + " " + (a.user.lastName ?? "")).trim() ||
          a.user.daliEmail ||
          a.user.id,
        present: a.present,
        markedAt: a.markedAt?.toISOString() ?? null,
      })),
    };
  });

  return {
    termId: args.termId ?? null,
    total: events.length,
    events,
  };
}
