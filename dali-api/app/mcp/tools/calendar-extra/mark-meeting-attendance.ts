import { prisma } from "~/lib/db.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { markMeetingAttendance } from "~/calendar/lib/meeting-roster.server";
import { parseOccurrenceParam, tracksAttendance } from "~/calendar/lib/meeting-occurrences";
import {
  classifyWalletScanFailure,
  memberIdFromToken,
  verifyWalletToken,
  walletTokensConfigured,
} from "~/wallet/lib/wallet-token.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { McpNotFoundError, McpForbiddenError, McpInvalidError } from "../../registry";

export const MARK_MEETING_ATTENDANCE_DEF = {
  name: "mark_meeting_attendance",
  description:
    "Mark a participant present or absent for a meeting, by userId or by scanning their wallet-pass barcode (memberToken, which marks present and returns the member). Allowed for the meeting organizer, Core members, or project members of the meeting's project. Without a token, only meetings with an attendance roster (a type, a notebook, self check-in or invited people) can be marked.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id.",
      },
      userId: {
        type: "string",
        minLength: 1,
        description: "User.id of the participant to mark. Use this or memberToken.",
      },
      memberToken: {
        type: "string",
        minLength: 1,
        description: "Signed wallet-pass member token from the scanned barcode. Use this or userId.",
      },
      present: {
        type: "boolean",
        description: "true = present, false = absent. Required with userId; with memberToken it is always present.",
      },
      occurrenceStart: {
        type: "string",
        description:
          "userId only: for a recurring meeting, when the occurrence to mark starts (ISO 8601). Omit for a one-off meeting or its first occurrence.",
      },
    },
    required: ["meetingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  meetingId: string;
  userId?: string;
  memberToken?: string;
  present?: boolean;
  occurrenceStart?: string;
};

type MarkResult = {
  ok: true;
  member?: { id: string; firstName: string; lastName: string; photoUrl: string | null };
};

export async function runMarkMeetingAttendance(callerId: string, input: Input): Promise<MarkResult> {
  if (!input.userId === !input.memberToken) {
    throw new McpInvalidError("Pass exactly one of userId or memberToken");
  }
  if (input.memberToken) {
    if (input.present === false) throw new McpInvalidError("A scanned pass can only mark present");
    if (!walletTokensConfigured()) throw new McpInvalidError("Wallet check-in isn't enabled");
  } else if (input.present === undefined) {
    throw new McpInvalidError("present is required with userId");
  }

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      organizerId: true,
      projectId: true,
      meetingType: true,
      notebookId: true,
      attendanceMode: true,
      participantUserIds: true,
    },
  });

  if (!meeting || (!input.memberToken && !tracksAttendance(meeting))) {
    throw new McpNotFoundError("Meeting not found");
  }

  const [core, member] = await Promise.all([
    isCore(callerId),
    meeting.projectId ? isProjectMember(callerId, meeting.projectId) : Promise.resolve(false),
  ]);
  const canEdit = callerId === meeting.organizerId || core || member;
  if (!canEdit) throw new McpForbiddenError();

  if (input.memberToken) return scanAttendee(callerId, meeting.id, input.memberToken);

  const result = await markMeetingAttendance(
    meeting.id,
    input.userId!,
    input.present!,
    callerId,
    parseOccurrenceParam(input.occurrenceStart),
  );
  throwOnFailure(result, "Attendance update failed");
  return { ok: true };
}

function throwOnFailure(result: { ok: boolean; status?: number; error?: string }, fallback: string) {
  if (result.ok) return;
  const status = result.status ?? 400;
  if (status === 404) throw new McpNotFoundError(result.error ?? "Not found");
  if (status === 403) throw new McpForbiddenError(result.error ?? "Forbidden");
  throw new McpInvalidError(result.error ?? fallback);
}

async function scanAttendee(callerId: string, meetingId: string, memberToken: string): Promise<MarkResult> {
  const scannedId = memberIdFromToken(memberToken);
  const scanned = scannedId
    ? await prisma.user.findUnique({
        where: { id: scannedId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          walletPassSecret: true,
        },
      })
    : null;

  const verified = scanned
    ? verifyWalletToken(memberToken, scanned.walletPassSecret)
    : ({ ok: false } as const);

  if (!scanned || !verified.ok) {
    console.error(
      `mark_meeting_attendance: rejected pass (meeting=${meetingId}, member=${scannedId ?? "?"}, reason=${classifyWalletScanFailure(
        memberToken,
        scanned,
      )})`,
    );
    throw new McpInvalidError("Invalid or revoked pass");
  }

  const result = await markMeetingAttendance(meetingId, scanned.id, true, callerId, new Date());
  throwOnFailure(result, "Scan check-in failed");

  return {
    ok: true,
    member: {
      id: scanned.id,
      firstName: scanned.firstName,
      lastName: scanned.lastName,
      photoUrl: await resolvePhotoUrl(scanned.photoUrl),
    },
  };
}
