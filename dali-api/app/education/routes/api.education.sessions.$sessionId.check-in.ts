import type { Route } from "./+types/api.education.sessions.$sessionId.check-in";
import QRCode from "qrcode";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isOfferingManager } from "~/education/lib/access.server";
import {
  isSessionCheckInOpen,
  selfCheckInToSession,
} from "~/education/lib/session-checkin.server";

// GET /api/education/sessions/:sessionId/check-in[?qr=1]
//
// Manager-only status read for the course page's Editing mode: the live
// "N of M in" count (polled while check-in is open) and, with ?qr=1, the
// projectable QR + link for the session's self-check-in URL.

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const session = await prisma.educationSession.findUnique({
    where: { id: params.sessionId! },
    select: { id: true, offeringId: true, datetime: true, endsAt: true, checkInOpenAt: true },
  });
  if (!session) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await isOfferingManager(auth.user.sub, session.offeringId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [presentCount, totalCount] = await Promise.all([
    prisma.educationAttendance.count({
      where: { sessionId: session.id, status: "Present" },
    }),
    prisma.educationApplication.count({
      where: { offeringId: session.offeringId, status: "Approved" },
    }),
  ]);

  const wantsQr = new URL(request.url).searchParams.get("qr") === "1";
  const checkInUrl = wantsQr
    ? `${new URL(request.url).origin}/education/check-in/${session.id}`
    : null;
  const checkInQrSvg = checkInUrl
    ? await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 200 })
    : null;

  return Response.json({
    open: isSessionCheckInOpen(session),
    presentCount,
    totalCount,
    checkInUrl,
    checkInQrSvg,
  });
}

// POST /api/education/sessions/:sessionId/check-in
//
// Self-serve attendance for an education session — the student scans the
// projected QR (or opens the link), and this marks THEM present. Like the
// meeting self-check-in route, there is no token in the body: the user is taken
// from their own session (auth.user.sub), so it can never mark someone else. The
// session must have check-in open and be inside its window, and the caller must
// be an Approved enrollee — all enforced in selfCheckInToSession.

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.type === "applicant") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await selfCheckInToSession({
    sessionId: params.sessionId!,
    userId: auth.user.sub,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, alreadyPresent: result.alreadyPresent });
}
