// MCP `list_scheduled_meetings` — list all meetings the caller organizes or
// attends (past + future), with optional status/role filters.
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";

export const LIST_SCHEDULED_MEETINGS_DEF = {
  name: "list_scheduled_meetings",
  description:
    "List all meetings the authenticated member organizes or attends. Returns past and future meetings. Supports filtering by status, role, and limit.",
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
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Maximum number of meetings to return (default 50).",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  status?: "Searching" | "Confirmed" | "Cancelled";
  role?: "organizer" | "participant" | "any";
  limit?: number;
};

export async function runListScheduledMeetings(userId: string, input: Input) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
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

  const meetings = await prisma.scheduledMeeting.findMany({
    where: whereClause,
    select: {
      id: true,
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
    orderBy: { createdAt: "desc" },
    take: limit,
  });

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
  };
}
