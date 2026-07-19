import { useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.attendance";
import { adminPills } from "~/admin-console/adminPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { TermFilter } from "~/components/TermFilter";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isAdmin } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { fullName, formatDateShort, formatDateTime } from "~/lib/display";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  UserCheck,
  UserX,
} from "lucide-react";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Attendance · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const { terms, selected, termId, isAll } = await resolveTermFilter(request);

  // Term window for selectedAt filtering. Meetings without a start time are
  // only included in the All-terms view so a half-planned event doesn't
  // vanish from every term.
  let dateWhere: { gte?: Date; lte?: Date } | undefined;
  if (!isAll && termId) {
    const term = await prisma.term.findUnique({
      where: { id: termId },
      select: { startDate: true, endDate: true },
    });
    if (term) dateWhere = { gte: term.startDate, lte: term.endDate };
  }

  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      attendanceMode: "SelfCheckIn",
      ...(dateWhere
        ? { selectedAt: dateWhere }
        : isAll
          ? {}
          : { selectedAt: { not: null } }),
    },
    orderBy: [{ selectedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      selectedAt: true,
      meetingType: true,
      meetingTypeLabel: true,
      project: { select: { id: true, name: true } },
      notePage: { select: { id: true } },
      organizer: {
        select: { firstName: true, lastName: true, daliEmail: true },
      },
      attendance: {
        orderBy: { user: { lastName: "asc" } },
        select: {
          present: true,
          markedAt: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              daliEmail: true,
            },
          },
        },
      },
    },
  });

  return {
    terms,
    selected,
    viewerIsAdmin: await isAdmin(auth.user.sub),
    events: meetings.map((m) => {
      const invited = m.attendance.length;
      const checkedIn = m.attendance.filter((a) => a.present).length;
      const typeLabel =
        m.meetingType === "Other"
          ? m.meetingTypeLabel || "Other"
          : (m.meetingType ?? "Meeting");
      return {
        id: m.id,
        title: m.title,
        typeLabel,
        startsAt: m.selectedAt?.toISOString() ?? null,
        projectName: m.project?.name ?? null,
        projectId: m.project?.id ?? null,
        notePageId: m.notePage?.id ?? null,
        organizerName: fullName(m.organizer) || m.organizer.daliEmail || "—",
        invited,
        checkedIn,
        attendees: m.attendance.map((a) => ({
          id: a.user.id,
          name: fullName(a.user) || a.user.daliEmail || a.user.id,
          present: a.present,
          markedAt: a.markedAt?.toISOString() ?? null,
        })),
      };
    }),
  };
}

type Attendee = {
  id: string;
  name: string;
  present: boolean;
  markedAt: string | null;
};

export default function AdminAttendancePage() {
  const { terms, selected, viewerIsAdmin, events } = useLoaderData<typeof loader>();
  const [openId, setOpenId] = useState<string | null>(events[0]?.id ?? null);

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav
        items={adminPills({ isAdmin: viewerIsAdmin, active: "attendance" })}
      />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent-coral font-medium">
            Self check-in
          </p>
          <h1 className="font-heading text-2xl font-bold text-foreground mt-0.5">
            Attendance
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-lg">
            Who was invited to QR check-in events, and who actually checked in.
          </p>
        </div>
        <TermFilter terms={terms} selected={selected} />
      </header>

      {events.length === 0 ? (
        <div className="bg-card border border-border shadow-brand-1 rounded-lg p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-coral/10">
            <ClipboardCheck className="w-6 h-6 text-accent-coral" aria-hidden />
          </div>
          <p className="font-heading font-semibold text-foreground">
            No self check-in events this term
          </p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            In Calendar, create a meeting and turn on{" "}
            <span className="text-foreground">Self check-in (QR)</span>. Add the
            people or groups to invite under Participants — a project is optional.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
            const open = openId === event.id;
            const pct =
              event.invited > 0
                ? Math.round((event.checkedIn / event.invited) * 100)
                : 0;
            const present = event.attendees.filter((a) => a.present);
            const missing = event.attendees.filter((a) => !a.present);
            return (
              <li
                key={event.id}
                className="bg-card border border-border shadow-brand-1 rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : event.id)}
                  aria-expanded={open}
                  className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-coral/40"
                >
                  <span className="mt-1 text-muted-foreground flex-shrink-0" aria-hidden>
                    {open ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-heading font-semibold text-foreground truncate">
                        {event.title}
                      </h2>
                      <span className="text-[11px] rounded-md px-2 py-0.5 bg-accent-coral/10 text-accent-coral font-medium">
                        {event.typeLabel}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {[
                        event.startsAt
                          ? formatDateShort(new Date(event.startsAt))
                          : "No start time",
                        event.projectName ?? "No project",
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
                  {event.notePageId && (
                    <Link
                      to={`/documents/${event.notePageId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-accent-coral hover:bg-accent-coral/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40"
                      title="Open meeting note"
                      aria-label="Open meeting note"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  )}
                </button>

                {open && (
                  <div className="border-t border-border bg-muted/15">
                    <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-border">
                      <EventStat label="Invited" value={String(event.invited)} />
                      <EventStat label="Checked in" value={String(event.checkedIn)} />
                      <EventStat
                        label="Rate"
                        value={event.invited ? `${pct}%` : "—"}
                      />
                    </div>
                    {event.attendees.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-muted-foreground italic">
                        No invitees on this event.
                      </p>
                    ) : (
                      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
                        <RosterColumn
                          icon={UserCheck}
                          title="Checked in"
                          count={present.length}
                          tone="present"
                          attendees={present}
                          empty="Nobody has checked in yet."
                        />
                        <RosterColumn
                          icon={UserX}
                          title="Not submitted"
                          count={missing.length}
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
          })}
        </ul>
      )}
    </div>
  );
}

function RosterColumn({
  icon: Icon,
  title,
  count,
  tone,
  attendees,
  empty,
}: {
  icon: typeof UserCheck;
  title: string;
  count: number;
  tone: "present" | "missing";
  attendees: Attendee[];
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-border/80">
        <Icon
          className={`w-3.5 h-3.5 ${
            tone === "present" ? "text-accent-teal" : "text-muted-foreground"
          }`}
          aria-hidden
        />
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <span className="ml-auto text-xs tabular-nums text-foreground font-medium">
          {count}
        </span>
      </div>
      {attendees.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground italic">{empty}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto divide-y divide-border/60">
          {attendees.map((a) => (
            <li
              key={a.id}
              className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="text-foreground truncate">{a.name}</span>
              {a.present && a.markedAt && (
                <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                  {formatDateTime(a.markedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-heading text-base font-semibold text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}
