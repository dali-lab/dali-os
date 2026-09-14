// MCP `scan_attendee` — wallet-pass scan check-in. The organizer/Core runs the
// scan station; the member's barcode token marks that member present. Mirrors
// api.scheduled-meetings.$id.scan-attendee.ts logic. Requires `mcp:write`.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { markMeetingAttendance, isWithinCheckInWindow } from "~/lib/scheduled-meeting";
import {
  memberIdFromToken,
  verifyWalletToken,
  walletTokensConfigured,
} from "~/lib/wallet-token";
import { resolvePhotoUrl } from "~/lib/photo";
import { McpNotFoundError, McpForbiddenError, McpInvalidError } from "../../registry";

export const SCAN_ATTENDEE_DEF = {
  name: "scan_attendee",
  description:
    "Scan a member's wallet-pass barcode token to mark them present at a meeting. The caller must be the meeting organizer, a Core member, or a project member. Only works within the check-in window (±15 min). Wallet check-in must be configured.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meetingId: {
        type: "string",
        minLength: 1,
        description: "ScheduledMeeting.id.",
      },
      memberToken: {
        type: "string",
        minLength: 1,
        description: "Signed wallet-pass member token from the scanned barcode.",
      },
    },
    required: ["meetingId", "memberToken"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { meetingId: string; memberToken: string };

export async function runScanAttendee(callerId: string, input: Input) {
  if (!walletTokensConfigured()) {
    throw new McpInvalidError("Wallet check-in isn't enabled");
  }

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: input.meetingId },
    select: {
      id: true,
      organizerId: true,
      projectId: true,
      meetingType: true,
      selectedAt: true,
      durationMinutes: true,
    },
  });

  if (!meeting || !meeting.meetingType) {
    throw new McpNotFoundError("Meeting not found");
  }

  // Operator gate: organizer, Core, or project member.
  const [core, member] = await Promise.all([
    isCore(callerId),
    meeting.projectId ? isProjectMember(callerId, meeting.projectId) : Promise.resolve(false),
  ]);
  const canMark = callerId === meeting.organizerId || core || member;
  if (!canMark) throw new McpForbiddenError();

  if (!isWithinCheckInWindow(meeting.selectedAt, meeting.durationMinutes)) {
    throw new McpForbiddenError("Check-in window is closed");
  }

  // Resolve the member from the token and verify the signature.
  const scannedId = memberIdFromToken(input.memberToken);
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
    ? verifyWalletToken(input.memberToken, scanned.walletPassSecret)
    : ({ ok: false } as const);

  if (!scanned || !verified.ok) {
    throw new McpInvalidError("Invalid or revoked pass");
  }

  const result = await markMeetingAttendance(meeting.id, scanned.id, true, callerId);
  if (!result.ok) {
    const status = result.status ?? 400;
    if (status === 404) throw new McpNotFoundError(result.error ?? "Not found");
    if (status === 403) throw new McpForbiddenError(result.error ?? "Forbidden");
    throw new McpInvalidError(result.error ?? "Scan check-in failed");
  }

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
