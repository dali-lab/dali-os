import { useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import QRCode from "qrcode";
import { FileText, Users, ScanLine, Shield, Video, Pencil, Clock } from "lucide-react";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { fullName } from "~/lib/display";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { AttendeeScanner } from "~/components/AttendeeScanner";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { EditMeetingModal } from "~/calendar/components/EditMeetingModal";
import { AddMeetingNoteButton } from "~/calendar/components/AddMeetingNoteModal";
import type { Route } from "./+types/calendar.meeting.$id";

export const meta: Route.MetaFunction = () => [{ title: "Meeting · DALI OS" }];

export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as { meetingLabel?: string } | undefined;
    return d?.meetingLabel || "Meeting";
  },
  // This page is the attendance/check-in surface for a meeting, so its home is
  // Attendance, not the URL-derived Calendar > Meeting trail.
  breadcrumbTrail: (data: unknown) => {
    const d = data as { meetingLabel?: string } | undefined;
    return [
      { label: "Attendance", to: "/attendance" },
      { label: d?.meetingLabel || "Event" },
    ];
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
      scopeType: true,
      isCoreMeeting: true,
      meetingUrl: true,
      organizer: { select: { firstName: true, lastName: true } },
      notePage: { select: { id: true } },
      attendance: {
        select: {
          userId: true,
          present: true,
          absenceNote: true,
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
  // A "None"-scoped meeting isn't addressed to a group or a hand-picked list —
  // it's the lab-wide kind, which is what an event on the general calendar
  // becomes when it's tracked. Any lab member can open it (read-only, since
  // canManage is unchanged); without this the popover would offer them an
  // Attendance link that 404s.
  const labWide = meeting.scopeType === "None" && roles.isLabMember;
  if (!canManage && !viewerRow && !labWide) throw new Response("Not found", { status: 404 });

  const selfCheckIn = meeting.attendanceMode === "SelfCheckIn";

  // Adding a note after the fact is the organizer's or Core's call — narrower
  // than canManage (a project member marks attendance but doesn't file the
  // meeting's doc), and the same authority attachMeetingNote re-checks.
  const canAddNote = auth.user.sub === meeting.organizerId || roles.isCore;

  const proposalRows = canManage
    ? await prisma.meetingTimeProposal.findMany({
        where: { scheduledMeetingId: meeting.id, status: "Pending" },
        select: {
          id: true,
          proposedStart: true,
          proposedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // The QR/link is a sharing affordance, so it's only generated for a manager.
  let checkInUrl: string | null = null;
  let checkInQrSvg: string | null = null;
  if (selfCheckIn && canManage) {
    const origin = new URL(request.url).origin;
    checkInUrl = `${origin}/calendar/check-in/${meeting.id}`;
    checkInQrSvg = await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 180 });
  }

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
    canAddNote,
    meetingUrl: meeting.meetingUrl,
    canManage,
    // Narrower than canManage: editing the event is the organizer's or Core's
    // call, as updateScheduledMeeting enforces.
    canInvite: auth.user.sub === meeting.organizerId || roles.isCore,
    selfCheckIn,
    rows: meeting.attendance.map((a) => ({
      userId: a.userId,
      name: fullName(a.user) || a.user.daliEmail || a.userId,
      present: a.present,
      // Withheld rather than merely hidden: a note can say why someone was
      // out, so a viewer who can't mark attendance never receives one.
      absenceNote: canManage ? a.absenceNote : null,
    })) satisfies AttendanceRow[],
    viewerInvited: viewerRow !== undefined,
    viewerPresent: viewerRow?.present ?? false,
    checkInUrl,
    checkInQrSvg,
    walletConfigured: walletTokensConfigured(),
    proposals: proposalRows.map((p) => ({
      id: p.id,
      proposedStartIso: p.proposedStart.toISOString(),
      proposerName: fullName(p.proposedBy),
    })),
  };
}

function ProposedTimesCard({
  meetingId,
  proposals,
}: {
  meetingId: string;
  proposals: { id: string; proposedStartIso: string; proposerName: string }[];
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string; gcalError?: string | null }>();

  if (proposals.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
        <Clock className="h-4 w-4 text-muted-foreground" /> Proposed times
      </h2>
      <ul className="flex flex-col gap-3">
        {proposals.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-sm font-medium text-foreground">{p.proposerName}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {new Date(p.proposedStartIso).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={fetcher.state !== "idle"}
                onClick={() =>
                  fetcher.submit(
                    { action: "accept", proposalId: p.id },
                    {
                      method: "post",
                      action: `/api/scheduled-meetings/${meetingId}/proposal`,
                      encType: "application/json",
                    },
                  )
                }
                className="inline-flex items-center rounded-md bg-accent-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-teal/90 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={fetcher.state !== "idle"}
                onClick={() =>
                  fetcher.submit(
                    { action: "decline", proposalId: p.id },
                    {
                      method: "post",
                      action: `/api/scheduled-meetings/${meetingId}/proposal`,
                      encType: "application/json",
                    },
                  )
                }
                className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      {fetcher.data?.error && (
        <p className="text-sm text-destructive">{fetcher.data.error}</p>
      )}
      {fetcher.data?.gcalError && (
        <p className="text-sm text-muted-foreground">
          Rescheduled, but Google Calendar sync failed: {fetcher.data.gcalError}
        </p>
      )}
    </section>
  );
}

const noteBtnClass =
  "inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted";

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
  // Same gate as the Add-to-Wallet buttons and the standalone scan station;
  // the /calendar/scan route re-checks both server-side. Require a roster too —
  // scanning a passholder into a meeting with no MeetingAttendance rows only ever
  // returns "not invited", so hide the station rather than show a dead scanner.
  const walletCheckin = useFeatureFlag("wallet-checkin");
  const canScan = d.canManage && walletCheckin && d.walletConfigured && d.rows.length > 0;
  const [editing, setEditing] = useState(false);

  return (
    // Full-bleed and left-aligned: the app shell already supplies the page
    // gutters, so this surface only owns its vertical rhythm.
    <div className="flex w-full flex-col items-stretch gap-5 text-left">
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
          {d.notePageId ? (
            <Link
              to={`/documents/${d.notePageId}`}
              className={noteBtnClass}
            >
              <FileText className="h-4 w-4 text-muted-foreground" /> Open meeting note
            </Link>
          ) : (
            d.canAddNote && (
              // A meeting created before notes existed (or with the note
              // toggle off) has no doc and, unless it synced to Google, never
              // appears on the calendar grid either — so this page is the only
              // place its organizer can start one. The action lives on
              // /calendar, which is also where the grid's popover posts it.
              <AddMeetingNoteButton
                meetingId={d.meetingId}
                isCoreMeeting={d.isCoreMeeting}
                actionPath="/calendar"
                className={noteBtnClass}
              />
            )
          )}
        </div>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
            <Users className="h-4 w-4 text-muted-foreground" /> Attendance
          </h2>
          <div className="flex items-center gap-3">
            {d.canManage && d.rows.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {present}/{d.rows.length} present
              </span>
            )}
            {d.canInvite && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" /> Edit event
              </button>
            )}
          </div>
        </div>
        {editing && (
          <EditMeetingModal meetingId={d.meetingId} onClose={() => setEditing(false)} />
        )}

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
          <AttendanceChecklist
            meetingId={d.meetingId}
            meetingLabel={d.meetingLabel}
            canEdit
            canNote={d.canManage}
            attendees={d.rows}
          />
        )}

        {/* The scanner is the point of opening this page during an event, so the
            camera comes up on its own rather than hiding behind a click into a
            second tab. /calendar/scan/:id stays as the full-screen kiosk for a
            door station; this is the in-page version for marking a few people. */}
        {canScan && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ScanLine className="h-4 w-4 text-muted-foreground" /> Scan wallet passes
            </p>
            <AttendeeScanner meetingId={d.meetingId} />
          </div>
        )}

        {!d.canManage && !d.selfCheckIn && (
          <p className="text-sm text-muted-foreground">
            {d.viewerPresent
              ? "You're marked present for this meeting."
              : "Your attendance will be marked by the organizer."}
          </p>
        )}
      </section>

      {d.canManage && d.proposals.length > 0 && (
        <ProposedTimesCard meetingId={d.meetingId} proposals={d.proposals} />
      )}
    </div>
  );
}
