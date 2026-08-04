import { useMemo, useState } from "react";
import {
  Link,
  redirect,
  useFetcher,
  useLoaderData,
} from "react-router";
import type { Route } from "./+types/admin.attendance";
import { adminHandle } from "~/admin/adminNav";
import { TermFilter } from "~/components/TermFilter";
import { Tooltip } from "~/components/ui/IconButton";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { fullName, formatDateShort, formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cancelScheduledMeeting } from "~/lib/scheduled-meeting";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";

export const handle = adminHandle("attendance");

export const meta: Route.MetaFunction = () => [
  { title: "Attendance · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
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
      status: { not: "Cancelled" },
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
      notePage: { select: { id: true, archivedAt: true } },
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
        // Only link to a live meeting note — archived pages 404 on /documents/:id.
        // SelfCheckIn events always have /calendar/check-in/:id as a working open target.
        notePageId:
          m.notePage && m.notePage.archivedAt === null ? m.notePage.id : null,
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

// Soft-cancel a self-check-in event (Core). Removes it from this list; same
// cancel path as the organizer calendar cancel, with allowCore so admins who
// didn't create the meeting can still clear it.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  if (form.get("intent") !== "delete-event") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }
  const meetingId = String(form.get("meetingId") ?? "");
  if (!meetingId) {
    return Response.json({ error: "Missing meetingId" }, { status: 400 });
  }

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: { id: true, attendanceMode: true },
  });
  if (!meeting || meeting.attendanceMode !== "SelfCheckIn") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const result = await cancelScheduledMeeting(meetingId, auth.user.sub, {
    allowCore: true,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
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
  startsAt: string | null;
  projectName: string | null;
  projectId: string | null;
  notePageId: string | null;
  organizerName: string;
  invited: number;
  checkedIn: number;
  attendees: Attendee[];
};

type SortKey =
  | "date-desc"
  | "date-asc"
  | "title-asc"
  | "title-desc"
  | "rate-desc"
  | "rate-asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "date-desc", label: "Date · newest" },
  { value: "date-asc", label: "Date · oldest" },
  { value: "title-asc", label: "Title · A–Z" },
  { value: "title-desc", label: "Title · Z–A" },
  { value: "rate-desc", label: "Check-in rate · high" },
  { value: "rate-asc", label: "Check-in rate · low" },
];

function checkInRate(event: AttendanceEvent): number {
  return event.invited > 0 ? event.checkedIn / event.invited : -1;
}

function sortEvents(events: AttendanceEvent[], sort: SortKey): AttendanceEvent[] {
  const copy = [...events];
  copy.sort((a, b) => {
    switch (sort) {
      case "date-asc": {
        const at = a.startsAt ? Date.parse(a.startsAt) : Number.POSITIVE_INFINITY;
        const bt = b.startsAt ? Date.parse(b.startsAt) : Number.POSITIVE_INFINITY;
        return at - bt || a.title.localeCompare(b.title);
      }
      case "date-desc": {
        const at = a.startsAt ? Date.parse(a.startsAt) : Number.NEGATIVE_INFINITY;
        const bt = b.startsAt ? Date.parse(b.startsAt) : Number.NEGATIVE_INFINITY;
        return bt - at || a.title.localeCompare(b.title);
      }
      case "title-asc":
        return a.title.localeCompare(b.title);
      case "title-desc":
        return b.title.localeCompare(a.title);
      case "rate-desc":
        return checkInRate(b) - checkInRate(a) || a.title.localeCompare(b.title);
      case "rate-asc":
        return checkInRate(a) - checkInRate(b) || a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
  return copy;
}

export default function AdminAttendancePage() {
  const { terms, selected, viewerIsAdmin, events } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date-desc");
  const [openId, setOpenId] = useState<string | null>(events[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? events
      : events.filter((event) => {
          const haystack = [
            event.title,
            event.typeLabel,
            event.projectName ?? "",
            event.organizerName,
            ...event.attendees.map((a) => a.name),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        });
    return sortEvents(matched, sort);
  }, [events, query, sort]);

  return (
    <div className="flex flex-col gap-4">

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
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="attendance-sort">
            Sort by
          </label>
          <SelectMenu
            ariaLabel="Sort by"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={SORT_OPTIONS}
            buttonClassName="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-48 inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <TermFilter terms={terms} selected={selected} />
        </div>
      </header>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by event, organizer, project, or attendee…"
          aria-label="Search attendance events"
          className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </div>

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
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border shadow-brand-1 rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
          No events match this search.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((event) => {
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
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : event.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left px-4 py-3.5 flex items-start gap-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-coral/40"
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
                            ? formatDateShort(new Date(event.startsAt), tz)
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
                  </button>
                  <div className="flex items-start gap-0.5 pr-3 pt-3.5 flex-shrink-0">
                    {/* Prefer the dedicated check-in surface — it always exists for
                        SelfCheckIn meetings. The meeting-note document can be
                        archived/missing and used to 404 from this icon. */}
                    <Tooltip label="Open check-in / QR" side="bottom">
                      <Link
                        to={`/calendar/check-in/${event.id}`}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-accent-coral hover:bg-accent-coral/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40"
                        aria-label="Open check-in / QR"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    </Tooltip>
                    {event.notePageId && (
                      <Tooltip label="Open meeting note" side="bottom">
                        <Link
                          to={`/documents/${event.notePageId}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-accent-coral hover:bg-accent-coral/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40"
                          aria-label="Open meeting note"
                        >
                          <ClipboardCheck className="w-4 h-4" />
                        </Link>
                      </Tooltip>
                    )}
                    <DeleteEventButton
                      meetingId={event.id}
                      title={event.title}
                    />
                  </div>
                </div>

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

function DeleteEventButton({
  meetingId,
  title,
}: {
  meetingId: string;
  title: string;
}) {
  const fetcher = useFetcher();
  const confirmSubmit = useConfirmSubmit();
  const busy = fetcher.state !== "idle";

  return (
    <Tooltip label="Delete event" side="bottom">
      <fetcher.Form
        method="post"
        onSubmit={confirmSubmit({
          title: `Delete attendance event "${title}"?`,
          description:
            "Invitees will be notified that the meeting was cancelled.",
          confirmLabel: "Delete",
          tone: "destructive",
        })}
      >
        <input type="hidden" name="intent" value="delete-event" />
        <input type="hidden" name="meetingId" value={meetingId} />
        <button
          type="submit"
          disabled={busy}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-50"
          aria-label={`Delete attendance event ${title}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </fetcher.Form>
    </Tooltip>
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
  const tz = useUserTimeZone();
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
