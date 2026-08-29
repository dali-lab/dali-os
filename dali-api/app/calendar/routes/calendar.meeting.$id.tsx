import { Link, useLoaderData } from "react-router";
import QRCode from "qrcode";
import { ChevronLeft, FileText, Users, ScanLine, Shield, Video } from "lucide-react";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { fullName } from "~/lib/display";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { AttendeeScanner } from "~/components/AttendeeScanner";
import type { Route } from "./+types/calendar.meeting.$id";

export const meta: Route.MetaFunction = () => [{ title: "Meeting · DALI OS" }];

export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as { meetingLabel?: string } | undefined;
    return d?.meetingLabel || "Meeting";
  },
};

// One place for a meeting: its details + note + the whole attendance surface —
// the live roster (organizer marks present/absent), the self check-in QR (shared
// with attendees), and the wallet scan station — instead of those being spread
// across the note page, a standalone check-in route, and a separate scan route.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const roles = await getUserRoles(auth.user.sub);
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      organizerId: true,
      meetingType: true,
      meetingTypeLabel: true,
      attendanceMode: true,
      projectId: true,
      selectedAt: true,
      durationMinutes: true,
      status: true,
      isCoreMeeting: true,
      meetingUrl: true,
      organizer: { select: { firstName: true, lastName: true } },
      notePage: { select: { id: true } },
      attendance: {
        select: {
          userId: true,
          present: true,
          user: { select: { firstName: true, lastName: true, daliEmail: true } },
        },
      },
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    throw new Response("Not found", { status: 404 });
  }

  // Managing (marking others, sharing the QR, scanning) is the organizer, Core,
  // or a project member — the same authority as the attendance-toggle route. An
  // invited attendee can still open the page to self check-in.
  const projectMember = meeting.projectId ? await isProjectMember(auth.user.sub, meeting.projectId) : false;
  const canManage = auth.user.sub === meeting.organizerId || roles.isCore || projectMember;
  const viewerRow = meeting.attendance.find((a) => a.userId === auth.user.sub);
  if (!canManage && !viewerRow) throw new Response("Not found", { status: 404 });

  const selfCheckIn = meeting.attendanceMode === "SelfCheckIn";

  // The QR/link is a sharing affordance, so it's only generated for a manager.
  let checkInUrl: string | null = null;
  let checkInQrSvg: string | null = null;
  if (selfCheckIn && canManage) {
    const origin = new URL(request.url).origin;
    checkInUrl = `${origin}/calendar/check-in/${meeting.id}`;
    checkInQrSvg = await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 180 });
  }

  const walletEnabled = canManage && (await isFeatureEnabled("wallet-checkin", auth.user.sub, roles, request));

  const typeLabel =
    meeting.meetingType === "Other"
      ? meeting.meetingTypeLabel || "Meeting"
      : (meeting.meetingType ?? "Meeting");

  return {
    meetingId: meeting.id,
    meetingLabel: meeting.title,
    typeLabel,
    isCoreMeeting: meeting.isCoreMeeting,
    organizerName: fullName(meeting.organizer),
    selectedAtIso: meeting.selectedAt ? meeting.selectedAt.toISOString() : null,
    notePageId: meeting.notePage?.id ?? null,
    meetingUrl: meeting.meetingUrl,
    canManage,
    selfCheckIn,
    rows: meeting.attendance.map((a) => ({
      userId: a.userId,
      name: fullName(a.user) || a.user.daliEmail || a.userId,
      present: a.present,
    })) satisfies AttendanceRow[],
    viewerInvited: viewerRow !== undefined,
    viewerPresent: viewerRow?.present ?? false,
    checkInUrl,
    checkInQrSvg,
    walletEnabled,
    walletConfigured: walletTokensConfigured(),
  };
}

export default function CalendarMeetingPage() {
  const d = useLoaderData<typeof loader>();
  // Format in the viewer's own timezone (browser locale) — no server tz needed.
  const when = d.selectedAtIso
    ? new Date(d.selectedAtIso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time not set";
  const present = d.rows.filter((r) => r.present).length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      <Link
        to="/calendar"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Calendar
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent-teal/15 px-2 py-0.5 text-xs font-medium text-accent-teal">
            {d.typeLabel}
          </span>
          {d.isCoreMeeting && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-yellow/20 px-2 py-0.5 text-xs font-medium text-foreground">
              <Shield className="h-3 w-3" /> Core
            </span>
          )}
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground">{d.meetingLabel}</h1>
        <p className="text-sm text-muted-foreground">
          {when}
          {d.organizerName ? ` · ${d.organizerName}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {d.meetingUrl && (
            <a
              href={d.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-teal/90"
            >
              <Video className="h-4 w-4" /> Join Google Meet
            </a>
          )}
          {d.notePageId && (
            <Link
              to={`/documents/${d.notePageId}`}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              <FileText className="h-4 w-4 text-muted-foreground" /> Open meeting note
            </Link>
          )}
        </div>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
            <Users className="h-4 w-4 text-muted-foreground" /> Attendance
          </h2>
          {d.canManage && d.rows.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {present}/{d.rows.length} present
            </span>
          )}
        </div>

        {d.selfCheckIn && (d.canManage || d.viewerInvited) && (
          <CheckInPanel
            meetingId={d.meetingId}
            meetingLabel={d.meetingLabel}
            viewerInvited={d.viewerInvited}
            initialPresent={d.viewerPresent}
            checkInUrl={d.checkInUrl}
            checkInQrSvg={d.checkInQrSvg}
          />
        )}

        {d.canManage && d.rows.length > 0 && (
          <AttendanceChecklist meetingId={d.meetingId} meetingLabel={d.meetingLabel} canEdit attendees={d.rows} />
        )}

        {d.walletEnabled && (
          <details className="rounded-lg border border-border">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-foreground">
              <ScanLine className="h-4 w-4 text-muted-foreground" /> Scan wallet passes
            </summary>
            <div className="p-3 pt-0">
              {d.walletConfigured ? (
                <AttendeeScanner meetingId={d.meetingId} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Wallet check-in isn't configured on this server yet.
                </p>
              )}
            </div>
          </details>
        )}

        {!d.canManage && !d.selfCheckIn && (
          <p className="text-sm text-muted-foreground">
            {d.viewerPresent
              ? "You're marked present for this meeting."
              : "Your attendance will be marked by the organizer."}
          </p>
        )}
      </section>
    </div>
  );
}
