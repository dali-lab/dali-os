import { useEffect, useState, type ReactNode } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import QRCode from "qrcode";
import { FileText, Users, Shield, Video, Pencil, Clock, MapPin, Shapes, Plus, QrCode } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { Radio } from "~/components/ui/Radio";
import { IconButton } from "~/components/ui/IconButton";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { useOsChrome } from "~/components/os-chrome";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { cn } from "~/lib/cn";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { fullName } from "~/lib/display";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { EditMeetingModal } from "~/calendar/components/EditMeetingModal";
import { AddMeetingNoteButton } from "~/calendar/components/AddMeetingNoteModal";
import { AddMeetingWhiteboardButton } from "~/calendar/components/AddMeetingWhiteboardModal";
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
      project: { select: { name: true } },
      selectedAt: true,
      durationMinutes: true,
      location: true,
      description: true,
      status: true,
      scopeType: true,
      isCoreMeeting: true,
      meetingUrl: true,
      organizer: { select: { firstName: true, lastName: true } },
      notePage: { select: { id: true } },
      whiteboardPage: { select: { id: true } },
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
    location: meeting.location,
    description: meeting.description,
    notePageId: meeting.notePage?.id ?? null,
    whiteboardPageId: meeting.whiteboardPage?.id ?? null,
    // Adding a whiteboard is the same authority as adding a note. hasType lets
    // the add flow skip the About/type step when the meeting already knows it.
    canAddWhiteboard: canAddNote,
    hasType: meeting.meetingType != null,
    canAddNote,
    // Adding/changing the meeting's project after the fact (behind the
    // unified-core-project-meetings flag) is the same authority as adding a
    // note; the action re-checks organizer/Core + project membership.
    canSetProject: canAddNote,
    projectId: meeting.projectId,
    projectName: meeting.project?.name ?? null,
    meetingType: meeting.meetingType,
    meetingUrl: meeting.meetingUrl,
    canManage,
    // Narrower than canManage: editing the event is the organizer's or Core's
    // call, as updateScheduledMeeting enforces.
    canInvite: auth.user.sub === meeting.organizerId || roles.isCore,
    selfCheckIn,
    // Switching an existing meeting to self check-in is the same authority as
    // editing it, narrowed to the roles that may create one (the create API's
    // canViewForms gate). The action re-checks both.
    canEnableSelfCheckIn:
      !selfCheckIn && (auth.user.sub === meeting.organizerId || roles.isCore) && roles.canViewForms,
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

// Turn on self check-in for a meeting created without it, so its QR code and
// link appear. The roster is backfilled the way attachMeetingNote does it, since
// check-in only marks people who already have an attendance row.
export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  if (form.get("intent") !== "enable-self-check-in") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: { id: true, organizerId: true, participantUserIds: true, status: true },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const roles = await getUserRoles(auth.user.sub);
  const canEdit = auth.user.sub === meeting.organizerId || roles.isCore;
  if (!canEdit || !roles.canViewForms) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.scheduledMeeting.update({
    where: { id: meeting.id },
    data: { attendanceMode: "SelfCheckIn" },
  });
  const attendeeIds = Array.from(new Set([...meeting.participantUserIds, meeting.organizerId]));
  await prisma.meetingAttendance.createMany({
    data: attendeeIds.map((userId) => ({ scheduledMeetingId: meeting.id, userId })),
    skipDuplicates: true,
  });
  return Response.json({ ok: true });
}

function ProposedTimesCard({
  meetingId,
  proposals,
}: {
  meetingId: string;
  proposals: { id: string; proposedStartIso: string; proposerName: string }[];
}) {
  const { card, sectionTitle } = useOsChrome();
  const fetcher = useFetcher<{ ok?: boolean; error?: string; gcalError?: string | null }>();

  if (proposals.length === 0) return null;

  function respond(action: "accept" | "decline", proposalId: string) {
    fetcher.submit(
      { action, proposalId },
      {
        method: "post",
        action: `/api/scheduled-meetings/${meetingId}/proposal`,
        encType: "application/json",
      },
    );
  }

  return (
    <section className={cn(card, "flex flex-col gap-5 p-6")}>
      <h2 className={cn(sectionTitle, "flex items-center gap-2")}>
        <Clock className="h-5 w-5 text-os-grey" /> Proposed times
      </h2>
      <ul className="flex flex-col gap-4">
        {proposals.map((p) => (
          <li key={p.id} className="flex flex-col gap-3">
            <div>
              <p className="text-base font-medium text-foreground">{p.proposerName}</p>
              <p className="text-sm text-os-grey">
                {new Date(p.proposedStartIso).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={fetcher.state !== "idle"}
                onClick={() => respond("accept", p.id)}
                className="os-btn-primary os-btn-primary--sm disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={fetcher.state !== "idle"}
                onClick={() => respond("decline", p.id)}
                className="os-btn-ghost py-1.5 disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
      {fetcher.data?.gcalError && (
        <p className="text-sm text-os-grey">
          Rescheduled, but Google Calendar sync failed: {fetcher.data.gcalError}
        </p>
      )}
    </section>
  );
}

// The design's outlined pill: every secondary action in the header row wears
// it, so "Add a project" reads as the same kind of control as "Add meeting notes".
const actionBtnClass = "os-edit-btn";

type MeetingTypeChoice = "Team" | "Partner" | "Other";

// Add or change the meeting's project after creation (behind the
// unified-core-project-meetings flag). Posts `set-meeting-project` to the
// calendar action, which sets the type/project and re-files the note into the
// project's meeting-notes folder. Shown only to the organizer or Core.
function MeetingProjectModal({
  meetingId,
  projectId,
  meetingType,
  onClose,
}: {
  meetingId: string;
  projectId: string | null;
  meetingType: "Team" | "Partner" | "Other" | null;
  onClose: () => void;
}) {
  const { formClass, formTrigger } = useOsChrome();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selProject, setSelProject] = useState(projectId ?? "");
  const [subtype, setSubtype] = useState<MeetingTypeChoice>(
    meetingType === "Partner" ? "Partner" : meetingType === "Other" ? "Other" : "Team",
  );
  const [label, setLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Same authorized set the create form's About picker uses (Projects
        // only): all projects for Core, own for a member.
        const res = await fetch("/api/move-destinations", { credentials: "include" });
        const json = await res.json();
        const dests = (json.destinations ?? []) as { type: string; id: string | null; label: string }[];
        if (!cancelled) {
          setProjects(
            dests.filter((x) => x.type === "Project" && x.id).map((x) => ({ id: x.id!, name: x.label })),
          );
        }
      } catch {
        // Leave empty. The picker still renders, just with no options to pick.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  const submitting = fetcher.state !== "idle";
  const canSubmit = !!selProject && (subtype !== "Other" || label.trim().length > 0) && !submitting;

  function submit() {
    if (!canSubmit) return;
    const fields: Record<string, string> = {
      intent: "set-meeting-project",
      meetingId,
      projectId: selProject,
      meetingType: subtype,
    };
    if (subtype === "Other") fields.meetingTypeLabel = label.trim();
    fetcher.submit(fields, { method: "post", action: "/calendar" });
  }

  return (
    <Modal open onClose={onClose} labelledBy="meeting-project-title">
      <ModalHeader
        titleId="meeting-project-title"
        title={projectId ? "Change project" : "Add a project"}
        subtitle="Files the meeting's note in the project and puts it on the project's calendar."
        onClose={onClose}
      />
      <div className={cn(formClass, "flex flex-col gap-5")}>
        <div className="flex flex-col gap-2">
          <span className="os-field-label">Project</span>
          <Select
            value={selProject}
            onChange={setSelProject}
            options={[
              { value: "", label: "Select a project…" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            buttonClassName={formTrigger}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="os-field-label">Meeting type</span>
          <div className="flex items-center gap-5">
            <Radio name="mp-subtype" checked={subtype === "Team"} onChange={() => setSubtype("Team")} label="Team" />
            <Radio name="mp-subtype" checked={subtype === "Partner"} onChange={() => setSubtype("Partner")} label="Partner" />
            <Radio name="mp-subtype" checked={subtype === "Other"} onChange={() => setSubtype("Other")} label="Other" />
          </div>
          {subtype === "Other" && (
            <input
              type="text"
              aria-label="Meeting type name"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Design review"
              maxLength={80}
              className="w-full"
            />
          )}
        </div>
        {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
      </div>
      <ModalFooter onCancel={onClose}>
        <button type="button" disabled={!canSubmit} onClick={submit} className="os-btn-primary disabled:opacity-50">
          {submitting ? "Saving…" : "Save"}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="os-field-label">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-base text-foreground">{children}</div>
    </div>
  );
}

export default function CalendarMeetingPage() {
  const d = useLoaderData<typeof loader>();
  const { card, pageTitle, sectionTitle } = useOsChrome();
  // Format in the viewer's own timezone (browser locale). No server tz needed.
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
  const pct = d.rows.length > 0 ? Math.round((present / d.rows.length) * 100) : 0;
  // Same gate as the Add-to-Wallet buttons and the standalone scan station;
  // the /calendar/scan route re-checks both server-side. The checklist only
  // renders with a roster, since scanning into a meeting with no
  // MeetingAttendance rows only ever returns "not invited".
  const [editing, setEditing] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const selfCheckInFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const showProject = d.projectId || d.canSetProject;

  return (
    // Full-bleed and left-aligned: the app shell already supplies the page
    // gutters, so this surface only owns its vertical rhythm.
    <div className="flex w-full flex-col items-stretch gap-10 pb-10 text-left">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">{d.typeLabel}</Pill>
          {d.isCoreMeeting && (
            <Pill>
              <Shield className="h-3.5 w-3.5" /> Core
            </Pill>
          )}
        </div>
        <h1 className={pageTitle}>{d.meetingLabel}</h1>
        {d.description && (
          <p className="max-w-3xl whitespace-pre-wrap text-base text-os-grey">{d.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {d.meetingUrl && (
            <a href={d.meetingUrl} target="_blank" rel="noreferrer" className="os-btn-primary">
              <Video className="h-4 w-4" /> Join Google Meet
            </a>
          )}
          {d.notePageId ? (
            <Link to={`/documents/${d.notePageId}`} className={actionBtnClass}>
              <FileText className="h-4 w-4" /> Open meeting note
            </Link>
          ) : (
            d.canAddNote && (
              // A meeting created before notes existed (or with the note
              // toggle off) has no doc and, unless it synced to Google, never
              // appears on the calendar grid either, so this page is the only
              // place its organizer can start one. The action lives on
              // /calendar, which is also where the grid's popover posts it.
              <AddMeetingNoteButton
                meetingId={d.meetingId}
                isCoreMeeting={d.isCoreMeeting}
                actionPath="/calendar"
                className={actionBtnClass}
              />
            )
          )}
          {d.whiteboardPageId ? (
            <Link to={`/whiteboard/${d.whiteboardPageId}`} className={actionBtnClass}>
              <Shapes className="h-4 w-4" /> Open whiteboard
            </Link>
          ) : (
            d.canAddWhiteboard && (
              <AddMeetingWhiteboardButton
                meetingId={d.meetingId}
                isCoreMeeting={d.isCoreMeeting}
                hasType={d.hasType}
                actionPath="/calendar"
                className={actionBtnClass}
              />
            )
          )}
          {d.canSetProject && !d.projectId && (
            <button type="button" onClick={() => setProjectOpen(true)} className={actionBtnClass}>
              <Plus className="h-4 w-4" /> Add a project
            </button>
          )}
          {d.canInvite && (
            <button type="button" onClick={() => setEditing(true)} className={actionBtnClass}>
              <Pencil className="h-4 w-4" /> Edit event
            </button>
          )}
        </div>
      </header>

      <div className={cn(card, "grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-4")}>
        <Fact label="When">{when}</Fact>
        {d.organizerName && <Fact label="Organizer">{d.organizerName}</Fact>}
        {d.location && (
          <Fact label="Location">
            <MapPin className="h-4 w-4 shrink-0 text-os-grey" />
            <span className="truncate">{d.location}</span>
          </Fact>
        )}
        {showProject && d.projectId && (
          <Fact label="Project">
            <Link to={`/projects/${d.projectId}`} className="truncate font-medium hover:underline">
              {d.projectName ?? "Project"}
            </Link>
            {d.canSetProject && (
              <IconButton label="Change project" icon={Pencil} onClick={() => setProjectOpen(true)} />
            )}
          </Fact>
        )}
      </div>

      {editing && <EditMeetingModal meetingId={d.meetingId} onClose={() => setEditing(false)} />}
      {projectOpen && (
        <MeetingProjectModal
          meetingId={d.meetingId}
          projectId={d.projectId}
          meetingType={d.meetingType}
          onClose={() => setProjectOpen(false)}
        />
      )}

      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className={cn(sectionTitle, "flex items-center gap-2.5 text-2xl")}>
            <Users className="h-6 w-6 text-os-accent" /> Attendance
          </h2>
          {d.canEnableSelfCheckIn && (
            <selfCheckInFetcher.Form method="post">
              <input type="hidden" name="intent" value="enable-self-check-in" />
              <button
                type="submit"
                disabled={selfCheckInFetcher.state !== "idle"}
                className={cn(actionBtnClass, "disabled:opacity-50")}
              >
                <QrCode className="h-4 w-4" />
                {selfCheckInFetcher.state !== "idle" ? "Turning on…" : "Turn on self check-in"}
              </button>
            </selfCheckInFetcher.Form>
          )}
        </div>
        {selfCheckInFetcher.data?.error && (
          <p className="text-sm text-destructive">{selfCheckInFetcher.data.error}</p>
        )}

        {d.canManage && d.rows.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="h-3 max-w-xl flex-1 overflow-hidden rounded-full bg-os-container">
              <div
                className="h-full rounded-full bg-os-accent transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-base font-medium tabular-nums text-foreground">
              {present} of {d.rows.length} present
            </span>
          </div>
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

        {/* The scanner is the point of opening this page during an event, so
            the camera comes up on its own. /calendar/scan/:id stays as the
            kiosk for a door station. */}
        {d.canManage && d.rows.length > 0 && (
          <AttendanceChecklist
            meetingId={d.meetingId}
            meetingLabel={d.meetingLabel}
            canEdit
            canNote={d.canManage}
            canScan={d.walletConfigured}
            defaultScanning
            plain
            attendees={d.rows}
          />
        )}

        {!d.canManage && !d.selfCheckIn && (
          <p className="text-base text-os-grey">
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
