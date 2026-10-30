import type { Route } from "./+types/api.events.$eventId.check-in-qr.pdf";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { getUserRoles, isCycleAdmin } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { renderCheckInQrPdf } from "~/calendar/lib/check-in-qr-pdf.server";

// GET /api/hiring/events/:eventId/check-in-qr.pdf — Core download of the
// self-check-in QR as a PDF for printing/projecting. Same share gate as the
// QR card on the cycle page (isCycleAdmin on the event's cycle).
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("application-events", auth.user.sub, roles, request))) {
    return new Response("Not found", { status: 404 });
  }

  const event = await prisma.hiringEvent.findUnique({
    where: { id: params.eventId },
    select: { id: true, title: true, applicationCycleId: true },
  });
  if (!event) return new Response("Not found", { status: 404 });

  if (!(await isCycleAdmin(auth.user.sub, event.applicationCycleId))) {
    return new Response("Not found", { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const checkInUrl = `${origin}/hiring/events/check-in/${event.id}`;

  const pdf = await renderCheckInQrPdf({ meetingTitle: event.title, checkInUrl });

  const safeTitle =
    event.title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") || "event";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="DALI_check-in_${safeTitle}.pdf"`,
    },
  });
}
