import { useLoaderData } from "react-router";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { AttendeeScanner } from "~/components/AttendeeScanner";
import { useOsChrome } from "~/components/os-chrome";
import type { Route } from "./+types/calendar.scan.$meetingId";

export const meta: Route.MetaFunction = () => [{ title: "Scan check-in · DALI OS" }];

export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as { meetingLabel?: string } | undefined;
    return d?.meetingLabel ? `Scan · ${d.meetingLabel}` : "Scan check-in";
  },
};

// Organizer/Core scan station: point the camera at a member's wallet pass to
// mark them present. Same operator gate as the attendance-toggle route — the
// authority to mark someone else present is the operator's own session, so this
// surface is gated to the organizer, Core, or a project member. Feature-flagged
// (wallet-checkin) so it's invisible until launch.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) throw portalRedirect;

  const roles = await getUserRoles(auth.user.sub);

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.meetingId },
    select: {
      id: true,
      title: true,
      organizerId: true,
      projectId: true,
      status: true,
    },
  });
  // No meetingType requirement — a SelfCheckIn all-lab event has none but is a
  // valid scan target (matches the scan endpoint and the meeting-detail page).
  if (!meeting || meeting.status === "Cancelled") {
    throw new Response("Not found", { status: 404 });
  }

  const projectMember = meeting.projectId
    ? await isProjectMember(auth.user.sub, meeting.projectId)
    : false;
  const canScan = auth.user.sub === meeting.organizerId || roles.isCore || projectMember;
  if (!canScan) throw new Response("Not found", { status: 404 });

  return {
    meetingId: meeting.id,
    meetingLabel: meeting.title,
    walletConfigured: walletTokensConfigured(),
  };
}

export default function CalendarScanPage() {
  const data = useLoaderData<typeof loader>();
  const { pageTitle, bodyText } = useOsChrome();
  return (
    <div className="flex w-full flex-col gap-6 pb-10">
      <header className="flex flex-col gap-2">
        <span className="os-field-label">Scan check-in</span>
        <h1 className={pageTitle}>{data.meetingLabel}</h1>
        <p className={bodyText}>Hold each member's wallet pass up to the camera.</p>
      </header>

      {!data.walletConfigured ? (
        <p className={bodyText}>Wallet check-in isn't set up on this server yet.</p>
      ) : (
        <div className="w-full max-w-4xl">
          <AttendeeScanner meetingId={data.meetingId} />
        </div>
      )}
    </div>
  );
}
