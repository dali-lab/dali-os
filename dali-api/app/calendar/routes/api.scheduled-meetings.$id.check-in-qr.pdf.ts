import type { Route } from "./+types/api.scheduled-meetings.$id.check-in-qr.pdf";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { renderCheckInQrPdf } from "~/calendar/lib/check-in-qr-pdf.server";

// Resource route: organizer/Core download of the self-check-in QR as a PDF
// for printing or projecting. Same share gate as CheckInPanel's QR card.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      organizerId: true,
      attendanceMode: true,
      status: true,
      notePage: { select: { id: true } },
    },
  });
  if (!meeting || meeting.attendanceMode !== "SelfCheckIn" || meeting.status === "Cancelled") {
    return new Response("Not found", { status: 404 });
  }

  const canShare = (await isCore(auth.user.sub)) || auth.user.sub === meeting.organizerId;
  if (!canShare) return new Response("Not found", { status: 404 });

  const origin = new URL(request.url).origin;
  // Mirror the URL encoded into the on-page QR: note page when one exists,
  // otherwise the standalone check-in surface.
  const checkInUrl = meeting.notePage
    ? `${origin}/documents/${meeting.notePage.id}`
    : `${origin}/calendar/check-in/${meeting.id}`;

  const pdf = await renderCheckInQrPdf({
    meetingTitle: meeting.title,
    checkInUrl,
  });

  const safeTitle =
    meeting.title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") || "meeting";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="DALI_check-in_${safeTitle}.pdf"`,
    },
  });
}
