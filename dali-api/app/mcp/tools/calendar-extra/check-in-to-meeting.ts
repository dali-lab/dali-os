import { prisma } from "~/lib/db.server";
import { markMeetingAttendance } from "~/calendar/lib/meeting-roster.server";
import { isWithinCheckInWindow } from "~/calendar/lib/meeting-occurrences";
import { McpNotFoundError, McpInvalidError, McpForbiddenError } from "../../registry";

type Input = { meetingId: string };

export async function runCheckInToMeeting(userId: string, input: Input) {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      attendanceMode: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      exceptions: {
        select: {
          originalStart: true,
          overrideStart: true,
          overrideDurationMin: true,
          cancelled: true,
        },
      },
    },
  });

  if (!meeting || meeting.attendanceMode !== "SelfCheckIn") {
    throw new McpNotFoundError("Meeting not found");
  }

  if (!meeting.selectedAt) {
    throw new McpInvalidError("This meeting doesn't have a scheduled time yet");
  }

  if (!isWithinCheckInWindow(meeting, meeting.exceptions)) {
    throw new McpForbiddenError("Check-in window has closed");
  }

  const result = await markMeetingAttendance(meeting.id, userId, true, userId, new Date());
  if (!result.ok) {
    const status = result.status ?? 400;
    if (status === 404) throw new McpNotFoundError(result.error ?? "Not found");
    if (status === 403) throw new McpForbiddenError(result.error ?? "Forbidden");
    throw new McpInvalidError(result.error ?? "Check-in failed");
  }

  return { ok: true };
}
