import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";

/**
 * Notifications, the desktop agenda and the mobile API all link to
 * `/calendar?meeting=<id>`, and sent notifications keep that link forever, so
 * it opens the meeting's page here. A cancelled or deleted meeting has no page
 * to open and stays on the calendar.
 */
export async function meetingLinkRedirect(url: URL): Promise<Response | null> {
  const id = url.searchParams.get("meeting");
  if (!id) return null;
  const meeting = await prisma.scheduledMeeting.findUnique({ where: { id }, select: { status: true } });
  if (!meeting || meeting.status === "Cancelled") return null;
  return redirect(`/calendar/meeting/${encodeURIComponent(id)}`);
}
