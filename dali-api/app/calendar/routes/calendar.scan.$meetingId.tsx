import { useLoaderData } from "react-router";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { AttendeeScanner } from "~/components/AttendeeScanner";
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
  if (!(await isFeatureEnabled("wallet-checkin", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.meetingId },
    select: {
      id: true,
      title: true,
      organizerId: true,
      projectId: true,
      meetingType: true,
      status: true,
    },
  });
  if (!meeting || !meeting.meetingType || meeting.status === "Cancelled") {
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
  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <div className="text-center mb-5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Scan check-in
        </p>
        <h1 className="font-heading text-xl font-bold text-foreground">{data.meetingLabel}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hold each member's DALI wallet pass up to the camera to mark them present.
        </p>
      </div>

      {!data.walletConfigured ? (
        <div className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          Wallet check-in isn't configured on this server yet, so passes can't be scanned.
        </div>
      ) : (
        <AttendeeScanner meetingId={data.meetingId} />
      )}
    </div>
  );
}
