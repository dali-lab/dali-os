import type { Route } from "./+types/api.scheduled-meetings.$id.scan-attendee";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { resolvePhotoUrl } from "~/lib/photo";
import { markMeetingAttendance, isWithinCheckInWindow } from "~/lib/scheduled-meeting";
import {
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
      meetingType: true,
      selectedAt: true,
      durationMinutes: true,
    },
  });
  if (!meeting || !meeting.meetingType) {
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

  if (!isWithinCheckInWindow(meeting.selectedAt, meeting.durationMinutes)) {
    return withCors(request, Response.json({ error: "Check-in window is closed" }, { status: 403 }));
  }

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
          walletPassSecret: true,
        },
      })
    : null;
  const verified = scanned
    ? verifyWalletToken(body.memberToken, scanned.walletPassSecret)
    : ({ ok: false } as const);
  if (!scanned || !verified.ok) {
    return withCors(request, Response.json({ error: "Invalid or revoked pass" }, { status: 400 }));
  }

  const result = await markMeetingAttendance(meeting.id, scanned.id, true, auth.user.sub);
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
