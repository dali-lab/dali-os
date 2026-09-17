import { useMemo, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  UserCheck,
  UserX,
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Route } from "./+types/attendance";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { fullName, formatDateShort, formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { useOsChrome } from "~/components/os-chrome";
import { SearchInput } from "~/components/ui/SearchInput";
import { useDialog } from "~/components/ui/dialog";
import { Menu, Select } from "~/components/ui/floating";
import { EditMeetingModal } from "~/calendar/components/EditMeetingModal";
import { AbsenceNoteButton, ABSENCE_NOTE_MAX } from "~/components/AbsenceNoteButton";
import {
  attendeeSortOptions,
  sortAttendees,
  type AttendeeSort,
} from "~/lib/attendee-sort";
import { cn } from "~/lib/cn";

// Each roster is already split into checked-in / not-submitted columns, so
// "Checked in first" would be a no-op here; the check-in time is the ordering
// this page adds to the shared name sorts.
const SORTS = attendeeSortOptions(["name-asc", "name-desc", "marked-desc"]);

export const meta: Route.MetaFunction = () => [{ title: "Attendance · DALI OS" }];

export const handle = {
  breadcrumb: () => "Attendance",
};

// Lab-wide Attendance: every meeting/event the
// viewer is invited to, across projects / teams / Core / general lab meetings,
// with each event's roster. Access is by invitation — we only surface a meeting
// whose participant list (or organizer) includes the viewer, so "you can see the
// attendance for an event you're invited to" is enforced by the query itself,
// with no Core-wide blanket. Marking still happens on the per-meeting page,
// which enforces its own organizer/Core/project-member gate.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const userId = auth.user.sub;

  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      status: { not: "Cancelled" },
      // Invited = organizer or on the participant list (mirrors calendar.server).
      AND: [
        { OR: [{ organizerId: userId }, { participantUserIds: { has: userId } }] },
        // Any meeting with a roster is attendance-tracked — notes, self check-in,
        // or a plain event with guests (createScheduledMeeting fans out a
        // MeetingAttendance row per participant whenever there are guests).
        { attendance: { some: {} } },
      ],
    },
    orderBy: [{ selectedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      selectedAt: true,
      durationMinutes: true,
      meetingType: true,
      meetingTypeLabel: true,
      isCoreMeeting: true,
      organizerId: true,
      project: { select: { id: true, name: true } },
      organizer: { select: { firstName: true, lastName: true, daliEmail: true } },
      attendance: {
        orderBy: { user: { lastName: "asc" } },
        select: {
          present: true,
          markedAt: true,
          absenceNote: true,
          userId: true,
          user: {
            select: { id: true, firstName: true, lastName: true, daliEmail: true },
          },
        },
      },
    },
  });

  // Who may write an absence note is the same gate as marking attendance, so
  // resolve it here per event rather than letting the roster offer an editor
  // the action would only reject. One membership query covers every event.
  const [core, assignments] = await Promise.all([
    isCore(userId),
    prisma.projectAssignment.findMany({
      where: { userId },
      select: { projectId: true },
    }),
  ]);
  const memberProjectIds = new Set(assignments.map((a) => a.projectId));

  const now = Date.now();
  const events = meetings.map((m) => {
    const canManage =
      m.organizerId === userId ||
      core ||
      (m.project !== null && memberProjectIds.has(m.project.id));
    // Editing/cancelling the event itself is the organizer's or Core's call —
    // narrower than canManage (project members can mark attendance but not
    // reschedule or delete a meeting they don't own). Mirrors the update/cancel
    // server gates.
    const canEdit = m.organizerId === userId || core;
    const invited = m.attendance.length;
    const checkedIn = m.attendance.filter((a) => a.present).length;
    const scope = m.project
      ? m.project.name
      : m.isCoreMeeting
        ? "Core"
        : "General";
    const typeLabel =
      m.meetingType === "Other"
        ? m.meetingTypeLabel || "Meeting"
        : (m.meetingType ?? "Meeting");
    const end = m.selectedAt
      ? m.selectedAt.getTime() + m.durationMinutes * 60_000
      : null;
    return {
      id: m.id,
      title: m.title,
      typeLabel,
      scope,
      startsAt: m.selectedAt?.toISOString() ?? null,
      // Unscheduled meetings (no time yet) sort with upcoming so they don't vanish.
      isPast: end !== null && end < now,
      organizerName: fullName(m.organizer) || m.organizer.daliEmail || "—",
      invited,
      checkedIn,
      viewerPresent:
        m.attendance.find((a) => a.userId === userId)?.present ?? false,
      canManage,
      canEdit,
      attendees: m.attendance.map((a) => ({
        id: a.user.id,
        name: fullName(a.user) || a.user.daliEmail || a.user.id,
        present: a.present,
        markedAt: a.markedAt?.toISOString() ?? null,
        // Withheld rather than merely hidden: a plain invitee's payload
        // shouldn't carry a note they aren't allowed to read.
        absenceNote: canManage ? a.absenceNote : null,
      })),
    };
  });

  return { events };
}

// Save (or clear) the absence note on one roster row. Writing is gated by the
// same organizer / Core / project-member rule that governs marking attendance —
// this page is otherwise read-only and open to everyone invited, so the gate is
// re-checked here rather than trusted from the loader's `canManage`.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  if (form.get("intent") !== "set-absence-note") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }
  const meetingId = String(form.get("meetingId") ?? "");
  const userId = String(form.get("userId") ?? "");
  if (!meetingId || !userId) {
    return Response.json({ error: "Missing meetingId or userId" }, { status: 400 });
  }
  const raw = String(form.get("note") ?? "").trim();
  if (raw.length > ABSENCE_NOTE_MAX) {
    return Response.json({ error: "Note is too long" }, { status: 400 });
  }
  // An emptied note clears the column rather than storing "".
  const absenceNote = raw || null;

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: { id: true, organizerId: true, projectId: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  const [core, member] = await Promise.all([
    isCore(auth.user.sub),
    meeting.projectId
      ? isProjectMember(auth.user.sub, meeting.projectId)
      : Promise.resolve(false),
  ]);
  if (auth.user.sub !== meeting.organizerId && !core && !member) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Note-only write: `present` and its TimeEntry mirror are untouched, and a
  // row that doesn't exist means the person isn't on this roster.
  const updated = await prisma.meetingAttendance.updateMany({
    where: { scheduledMeetingId: meeting.id, userId },
    data: { absenceNote },
  });
  if (updated.count === 0) {
    return Response.json({ error: "Not on this roster" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

type Attendee = {
  id: string;
  name: string;
  present: boolean;
  markedAt: string | null;
  absenceNote: string | null;
};

type AttendanceEvent = {
  id: string;
  title: string;
  typeLabel: string;
  scope: string;
  startsAt: string | null;
  isPast: boolean;
  organizerName: string;
  invited: number;
  checkedIn: number;
  viewerPresent: boolean;
  canManage: boolean;
  canEdit: boolean;
  attendees: Attendee[];
};

function startMs(e: AttendanceEvent, fallback: number): number {
  return e.startsAt ? Date.parse(e.startsAt) : fallback;
}

export default function AttendancePage() {
  const { events } = useLoaderData<typeof loader>();
  const { pageTitle, panel } = useOsChrome();
  const [query, setQuery] = useState("");
  // One control for every roster on the page: the cards all show the same kind
  // of list, so a per-card picker would just repeat itself down the page.
  const [sort, setSort] = useState<AttendeeSort>("name-asc");

  const { upcoming, past } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? events
      : events.filter((e) =>
          [e.title, e.typeLabel, e.scope, e.organizerName, ...e.attendees.map((a) => a.name)]
            .join(" ")
            .toLowerCase()
            .includes(q),
        );
    // Upcoming soonest-first (unscheduled last); past newest-first.
    const up = matched
      .filter((e) => !e.isPast)
      .sort((a, b) => startMs(a, Number.POSITIVE_INFINITY) - startMs(b, Number.POSITIVE_INFINITY));
    const pa = matched
      .filter((e) => e.isPast)
      .sort((a, b) => startMs(b, Number.NEGATIVE_INFINITY) - startMs(a, Number.NEGATIVE_INFINITY));
    return { upcoming: up, past: pa };
  }, [events, query]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className={pageTitle}>Attendance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every meeting and event you're invited to, with its roster.
        </p>
      </header>

      {events.length === 0 ? (
        <div className={cn(panel, "p-10 text-center")}>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-teal/10">
            <ClipboardCheck className="w-6 h-6 text-accent-teal" aria-hidden />
          </div>
          <p className="font-heading font-semibold text-foreground">
            No attendance events yet
          </p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            When you're invited to a meeting or event that tracks attendance —
            a project meeting, a Core meeting, or a self check-in event — it shows
            up here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              size="sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by event, organizer, scope, or attendee…"
              aria-label="Search attendance events"
              containerClassName="min-w-48 flex-1"
            />
            <Select
              value={sort}
              options={SORTS}
              onChange={setSort}
              ariaLabel="Sort attendees"
              align="right"
            />
          </div>
          {upcoming.length === 0 && past.length === 0 ? (
            <div className={cn(panel, "px-4 py-8 text-center text-sm text-muted-foreground")}>
              No events match this search.
            </div>
          ) : (
            <>
              <EventSection title="Upcoming" events={upcoming} panel={panel} sort={sort} />
              <EventSection title="Past" events={past} panel={panel} sort={sort} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function EventSection({
  title,
  events,
  panel,
  sort,
}: {
  title: string;
  events: AttendanceEvent[];
  panel: string;
  sort: AttendeeSort;
}) {
  if (events.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5" aria-hidden /> {title}
        <span className="tabular-nums text-muted-foreground/70">· {events.length}</span>
      </h2>
      <ul className="flex flex-col gap-3">
        {events.map((event) => (
          <EventCard key={event.id} event={event} panel={panel} sort={sort} />
        ))}
      </ul>
    </section>
  );
}

function EventCard({
  event,
  panel,
  sort,
}: {
  event: AttendanceEvent;
  panel: string;
  sort: AttendeeSort;
}) {
  const tz = useUserTimeZone();
  const dialog = useDialog();
  const cancelFetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const pct = event.invited > 0 ? Math.round((event.checkedIn / event.invited) * 100) : 0;
  const present = sortAttendees(event.attendees.filter((a) => a.present), sort);
  const missing = sortAttendees(event.attendees.filter((a) => !a.present), sort);

  async function cancelEvent() {
    const ok = await dialog.confirm({
      title: "Cancel this event?",
      description: `"${event.title}" will be removed for everyone invited, and disappears from Attendance. This can't be undone.`,
      confirmLabel: "Cancel event",
      cancelLabel: "Keep event",
      tone: "destructive",
    });
    if (!ok) return;
    cancelFetcher.submit(null, {
      method: "post",
      action: `/api/scheduled-meetings/${event.id}/cancel`,
    });
  }

  return (
    <li className={cn(panel, "overflow-hidden")}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left px-4 py-3.5 flex items-start gap-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-teal/40"
        >
          <span className="mt-1 text-muted-foreground flex-shrink-0" aria-hidden>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading font-semibold text-foreground truncate">
                {event.title}
              </h3>
              <span className="text-[11px] rounded-md px-2 py-0.5 bg-accent-teal/10 text-accent-teal font-medium">
                {event.typeLabel}
              </span>
              <span className="text-[11px] rounded-md px-2 py-0.5 bg-muted text-muted-foreground font-medium">
                {event.scope}
              </span>
              {event.viewerPresent && (
                <span className="text-[11px] rounded-md px-2 py-0.5 bg-accent-teal/15 text-accent-teal font-medium inline-flex items-center gap-1">
                  <UserCheck className="w-3 h-3" aria-hidden /> You're checked in
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {[
                event.startsAt ? formatDateShort(new Date(event.startsAt), tz) : "No start time",
                `Organizer ${event.organizerName}`,
              ].join(" · ")}
            </p>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-xs">
                <div
                  className="h-full bg-accent-teal rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                {event.checkedIn}/{event.invited} checked in
              </span>
            </div>
          </div>
        </button>
        <div className="flex items-start gap-0.5 pr-3 pt-3.5 flex-shrink-0">
          <Link
            to={`/calendar/meeting/${event.id}`}
            className="p-1.5 rounded-md text-muted-foreground hover:text-accent-teal hover:bg-accent-teal/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal/40"
            aria-label="Open meeting — check in or mark attendance"
            title="Open meeting"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
          {event.canEdit && (
            <Menu
              align="right"
              trigger={
                <button
                  type="button"
                  aria-label="Event options"
                  disabled={cancelFetcher.state !== "idle"}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal/40 disabled:opacity-50"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              }
            >
              <Menu.Item icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => setEditing(true)}>
                Edit event
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onSelect={cancelEvent}
                destructive
              >
                Cancel event
              </Menu.Item>
            </Menu>
          )}
        </div>
      </div>

      {editing && (
        <EditMeetingModal meetingId={event.id} onClose={() => setEditing(false)} />
      )}

      {open && (
        <div className="border-t border-border bg-muted/15">
          {event.attendees.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground italic">
              No invitees on this event.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
              <RosterColumn
                icon={UserCheck}
                title="Checked in"
                tone="present"
                meetingId={event.id}
                canManage={event.canManage}
                attendees={present}
                empty="Nobody has checked in yet."
              />
              <RosterColumn
                icon={UserX}
                title="Not submitted"
                tone="missing"
                meetingId={event.id}
                canManage={event.canManage}
                attendees={missing}
                empty="Everyone checked in."
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function RosterColumn({
  icon: Icon,
  title,
  tone,
  meetingId,
  canManage,
  attendees,
  empty,
}: {
  icon: typeof UserCheck;
  title: string;
  tone: "present" | "missing";
  meetingId: string;
  canManage: boolean;
  attendees: Attendee[];
  empty: string;
}) {
  const tz = useUserTimeZone();
  return (
    <div className="min-w-0">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-border/80">
        <Icon
          className={cn("w-3.5 h-3.5", tone === "present" ? "text-accent-teal" : "text-muted-foreground")}
          aria-hidden
        />
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
        <span className="ml-auto text-xs tabular-nums text-foreground font-medium">
          {attendees.length}
        </span>
      </div>
      {attendees.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground italic">{empty}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto divide-y divide-border/60">
          {attendees.map((a) => (
            <li key={a.id} className="px-4 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground truncate">{a.name}</span>
                <div className="flex items-baseline gap-1.5 flex-shrink-0">
                  {a.present && a.markedAt && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {formatDateTime(a.markedAt, tz)}
                    </span>
                  )}
                  {/* Notes belong to an absence, so the editor lives with the
                      missing column — plus anyone who already has one, so a
                      note doesn't become uneditable the moment its subject is
                      marked present. */}
                  {canManage && (tone === "missing" || a.absenceNote) && (
                    <AbsenceNoteButton
                      meetingId={meetingId}
                      userId={a.id}
                      name={a.name}
                      note={a.absenceNote}
                    />
                  )}
                </div>
              </div>
              {/* A note can say why someone was out, so it stays with the
                  people who mark attendance rather than the whole invite
                  list. */}
              {a.absenceNote && canManage && (
                <p className="mt-1 text-xs text-muted-foreground italic break-words">
                  {a.absenceNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
