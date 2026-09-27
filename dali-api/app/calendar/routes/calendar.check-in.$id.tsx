import { useLoaderData } from "react-router";
import QRCode from "qrcode";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { resolveMeetingOccurrence } from "~/lib/scheduled-meeting";
import { CheckInPanel } from "~/components/CheckInPanel";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/calendar.check-in.$id";

export const meta: Route.MetaFunction = () => [{ title: "Check in · DALI OS" }];

export const handle = {
  // Leaf only — "check-in" is dropped as a structural segment in Breadcrumbs
  // (there is no /calendar/check-in index; linking it 404'd as a duplicate crumb).
  breadcrumb: (data: unknown) => {
    const d = data as { meetingLabel?: string } | undefined;
    return d?.meetingLabel || "Check in";
  },
};

// Standalone self-check-in surface for meetings that don't have a meeting
// note (the note page hosts the same CheckInPanel when one exists). QR codes
// and share links point here when attendanceMode is SelfCheckIn and there's
// no document to open.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      organizerId: true,
      attendanceMode: true,
      status: true,
      participantUserIds: true,
      selectedAt: true,
      createdAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      externalEventId: true,
      attendance: {
        where: { userId: auth.user.sub },
        select: { present: true, occurrenceStart: true },
      },
    },
  });
  if (!meeting || meeting.attendanceMode !== "SelfCheckIn" || meeting.status === "Cancelled") {
    throw new Response("Not found", { status: 404 });
  }

  // Check-in is always into the occurrence happening now.
  const now = await resolveMeetingOccurrence(meeting, new Date());
  const viewerRow = meeting.attendance.find(
    (a) => a.occurrenceStart.getTime() === now.originalStart.getTime(),
  );
  const invited =
    meeting.attendance.length > 0 ||
    meeting.organizerId === auth.user.sub ||
    meeting.participantUserIds.includes(auth.user.sub);
  const canShare = (await isCore(auth.user.sub)) || auth.user.sub === meeting.organizerId;

  let checkInUrl: string | null = null;
  let checkInQrSvg: string | null = null;
  if (canShare) {
    const origin = new URL(request.url).origin;
    checkInUrl = `${origin}/calendar/check-in/${meeting.id}`;
    checkInQrSvg = await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 180 });
  }

  return {
    meetingId: meeting.id,
    meetingLabel: meeting.title,
    viewerInvited: invited,
    viewerPresent: viewerRow?.present ?? false,
    checkInUrl,
    checkInQrSvg,
  };
}

export default function CalendarCheckInPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <CheckInPanel
        meetingId={data.meetingId}
        meetingLabel={data.meetingLabel}
        viewerInvited={data.viewerInvited}
        initialPresent={data.viewerPresent}
        checkInUrl={data.checkInUrl}
        checkInQrSvg={data.checkInQrSvg}
      />
      {!data.viewerInvited && !data.checkInUrl && (
        <p className="text-sm text-muted-foreground mt-4 text-center">
          You weren't invited to this meeting, so there's nothing to check in for.
        </p>
      )}
    </div>
  );
}
