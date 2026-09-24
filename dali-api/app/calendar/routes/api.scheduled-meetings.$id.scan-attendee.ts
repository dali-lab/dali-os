import type { Route } from "./+types/api.scheduled-meetings.$id.scan-attendee";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { resolvePhotoUrl } from "~/lib/photo";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import {
  classifyWalletScanFailure,
  memberIdFromToken,
  verifyWalletToken,
  walletTokensConfigured,
} from "~/lib/wallet-token";

// POST /api/scheduled-meetings/:id/scan-attendee
//
// Wallet-pass scan check-in — the inverse of self-check-in. An organizer/Core
// runs the scan station (/calendar/scan/:id), the member shows the DALI
// membership pass in their wallet, and this marks THAT member present. The
// scanned barcode carries a signed member token (app/lib/wallet-token.ts); the
// authority to mark someone else present is the OPERATOR's own session — the
// same gate as the attendance-toggle route — while the member being marked is
// only ever taken from the verified token, never from the request body.

const BodySchema = z.object({
  memberToken: z.string().min(1),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant") return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!walletTokensConfigured()) {
    return withCors(
      request,
      Response.json({ error: "Wallet check-in isn't enabled" }, { status: 503 }),
    );
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      organizerId: true,
      projectId: true,
      attendanceMode: true,
    },
  });
  // Any real meeting is scannable — don't require a meetingType. An all-lab /
  // general attendance event created as SelfCheckIn carries no meetingType but
  // still has a roster (MeetingAttendance rows); the self-check-in route accepts
  // it, so the scan station must too. markMeetingAttendance rejects non-invitees
  // below (except walk-ins at a SelfCheckIn event), which is what keeps a
  // scheduling poll out.
  //
  // Deliberately NOT window-gated, unlike self-check-in. This is an operator
  // marking someone else present, and the operator can already do exactly that
  // at any time from AttendanceChecklist (api.scheduled-meetings.$id.attendance
  // has no window check) — so the gate granted no authority, it only broke
  // scanning whenever an event ran past its scheduled end.
  if (!meeting) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  // Operator gate: organizer, Core, or project-edit access — same as the
  // organizer-facing attendance-toggle route.
  const [core, member] = await Promise.all([
    isCore(auth.user.sub),
    meeting.projectId ? isProjectMember(auth.user.sub, meeting.projectId) : Promise.resolve(false),
  ]);
  const canMark = auth.user.sub === meeting.organizerId || core || member;
  if (!canMark) return forbidden(request);

  // Resolve the member from the token's id, then verify the signature against
  // THAT member's current secret — a leaked/screenshotted barcode from a
  // revoked pass no longer matches.
  const scannedId = memberIdFromToken(body.memberToken);
  const scanned = scannedId
    ? await prisma.user.findUnique({
        where: { id: scannedId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          daliEmail: true,
          walletPassSecret: true,
        },
      })
    : null;
  const verified = scanned
    ? verifyWalletToken(body.memberToken, scanned.walletPassSecret)
    : ({ ok: false } as const);
  if (!scanned || !verified.ok) {
    // One generic message to the client (don't leak member existence / secret
    // state), but log which of the four causes fired so the failure is
    // diagnosable from the field. See classifyWalletScanFailure for what each means.
    console.error(
      `scan-attendee: rejected pass (meeting=${meeting.id}, member=${scannedId ?? "?"}, reason=${classifyWalletScanFailure(
        body.memberToken,
        scanned,
      )})`,
    );
    return withCors(request, Response.json({ error: "Invalid or revoked pass" }, { status: 400 }));
  }

  // At an event (SelfCheckIn), any DALI member who shows up counts, invited or
  // not; regular meetings stay roster-only.
  const result = await markMeetingAttendance(meeting.id, scanned.id, true, auth.user.sub, {
    addIfMissing: meeting.attendanceMode === "SelfCheckIn" && !!scanned.daliEmail,
  });
  if (!result.ok) {
    // Most likely: the scanned member isn't on this meeting's roster.
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }

  return withCors(
    request,
    Response.json({
      ok: true,
      member: {
        id: scanned.id,
        firstName: scanned.firstName,
        lastName: scanned.lastName,
        photoUrl: await resolvePhotoUrl(scanned.photoUrl),
      },
    }),
  );
}
