// MCP `list_scheduled_meetings` — list all meetings the caller organizes or
// attends (past + future), with optional status/role filters.
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db.server";
import type { Prisma } from "~/generated/prisma/client";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_SCHEDULED_MEETINGS_DEF = {
  name: "list_scheduled_meetings",
  description:
    "List all meetings the authenticated member organizes or attends. Returns past and future meetings. Newest first. Supports filtering by status and role. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        enum: ["Searching", "Confirmed", "Cancelled"],
        description: "Filter by meeting status. Omit to return all statuses.",
      },
      role: {
        type: "string",
        enum: ["organizer", "participant", "any"],
        description: "Filter by caller's role in the meeting (default: any).",
      },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & {
  status?: "Searching" | "Confirmed" | "Cancelled";
  role?: "organizer" | "participant" | "any";
};

export async function runListScheduledMeetings(userId: string, input: Input) {
  const window = keysetWindow(input, PAGE_LIMITS, [{ field: "createdAt", direction: "desc", type: "date" }]);
  const role = input.role ?? "any";

  const statusFilter: Prisma.ScheduledMeetingWhereInput = input.status
    ? { status: input.status }
    : {};

  let whereClause: Prisma.ScheduledMeetingWhereInput;
  if (role === "organizer") {
    whereClause = { organizerId: userId, ...statusFilter };
  } else if (role === "participant") {
    whereClause = { participantUserIds: { has: userId }, ...statusFilter };
  } else {
    whereClause = {
      OR: [{ organizerId: userId }, { participantUserIds: { has: userId } }],
      ...statusFilter,
    };
  }

  const fetched = await prisma.scheduledMeeting.findMany({
    where: { AND: [whereClause, window.where] },
    select: {
      id: true,
      createdAt: true,
      title: true,
      status: true,
      selectedAt: true,
      durationMinutes: true,
      meetingType: true,
      projectId: true,
      attendanceMode: true,
      organizerId: true,
      participantUserIds: true,
      meetingUrl: true,
    },
    orderBy: window.orderBy,
    take: window.take,
  });
  const { rows: meetings, page } = keysetPage(fetched, window);

  return {
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      selectedAt: m.selectedAt ? m.selectedAt.toISOString() : null,
      durationMinutes: m.durationMinutes,
      meetingType: m.meetingType,
      projectId: m.projectId,
      attendanceMode: m.attendanceMode,
      meetingUrl: m.meetingUrl,
      participantCount: new Set([m.organizerId, ...m.participantUserIds]).size,
    })),
    page,
  };
}
