import { useMemo, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  UserCheck,
  UserX,
  CalendarClock,
} from "lucide-react";
import type { Route } from "./+types/attendance";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { prisma } from "~/lib/db";
import { fullName, formatDateShort, formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { useOsChrome } from "~/components/os-chrome";
import { SearchInput } from "~/components/ui/SearchInput";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Attendance · DALI OS" }];

export const handle = {
  breadcrumb: () => "Attendance",
};

// Lab-wide Attendance (feature flag `attendance`): every meeting/event the
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

  const roles = await getUserRoles(userId);
  const enabled = await isFeatureEnabled("attendance", userId, roles, request);
  if (!enabled) {
    // Flag off: the Core-only overview is still the live surface for Core; anyone
    // else has no attendance home yet, so send them to the app root.
    return redirect(roles.isCore ? "/core/attendance" : "/");
  }

  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      status: { not: "Cancelled" },
      // Invited = organizer or on the participant list (mirrors calendar.server).
      AND: [
        { OR: [{ organizerId: userId }, { participantUserIds: { has: userId } }] },
        // Only meetings that actually track attendance have a roster to show.
        { OR: [{ meetingType: { not: null } }, { attendanceMode: "SelfCheckIn" }] },
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
      project: { select: { id: true, name: true } },
      organizer: { select: { firstName: true, lastName: true, daliEmail: true } },
      attendance: {
        orderBy: { user: { lastName: "asc" } },
        select: {
          present: true,
          markedAt: true,
          userId: true,
          user: {
            select: { id: true, firstName: true, lastName: true, daliEmail: true },
          },
        },
      },
    },
  });

  const now = Date.now();
  const events = meetings.map((m) => {
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
      attendees: m.attendance.map((a) => ({
        id: a.user.id,
        name: fullName(a.user) || a.user.daliEmail || a.user.id,
        present: a.present,
        markedAt: a.markedAt?.toISOString() ?? null,
      })),
    };
  });

  return { events };
}

type Attendee = {
  id: string;
  name: string;
  present: boolean;
  markedAt: string | null;
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
  attendees: Attendee[];
};

function startMs(e: AttendanceEvent, fallback: number): number {
  return e.startsAt ? Date.parse(e.startsAt) : fallback;
}

export default function AttendancePage() {
  const { events } = useLoaderData<typeof loader>();
  const { pageTitle, panel } = useOsChrome();
  const [query, setQuery] = useState("");

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
          <SearchInput
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by event, organizer, scope, or attendee…"
            aria-label="Search attendance events"
            containerClassName="w-full"
          />
          {upcoming.length === 0 && past.length === 0 ? (
            <div className={cn(panel, "px-4 py-8 text-center text-sm text-muted-foreground")}>
              No events match this search.
            </div>
          ) : (
            <>
              <EventSection title="Upcoming" events={upcoming} panel={panel} />
              <EventSection title="Past" events={past} panel={panel} />
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
}: {
  title: string;
  events: AttendanceEvent[];
  panel: string;
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
          <EventCard key={event.id} event={event} panel={panel} />
        ))}
      </ul>
    </section>
  );
}

function EventCard({ event, panel }: { event: AttendanceEvent; panel: string }) {
  const tz = useUserTimeZone();
  const [open, setOpen] = useState(false);
  const pct = event.invited > 0 ? Math.round((event.checkedIn / event.invited) * 100) : 0;
  const present = event.attendees.filter((a) => a.present);
  const missing = event.attendees.filter((a) => !a.present);

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
        <div className="flex items-start pr-3 pt-3.5 flex-shrink-0">
          <Link
            to={`/calendar/meeting/${event.id}`}
            className="p-1.5 rounded-md text-muted-foreground hover:text-accent-teal hover:bg-accent-teal/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal/40"
            aria-label="Open meeting — check in or mark attendance"
            title="Open meeting"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>

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
                attendees={present}
                empty="Nobody has checked in yet."
              />
              <RosterColumn
                icon={UserX}
                title="Not submitted"
                tone="missing"
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
  attendees,
  empty,
}: {
  icon: typeof UserCheck;
  title: string;
  tone: "present" | "missing";
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
            <li key={a.id} className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-foreground truncate">{a.name}</span>
              {a.present && a.markedAt && (
                <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                  {formatDateTime(a.markedAt, tz)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
