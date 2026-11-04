import { useEffect, useMemo, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  UserCheck,
  UserX,
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Route } from "./+types/attendance";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { loadAttendanceFeed, type AttendanceCard } from "~/lib/attendance-feed.server";
import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";
import { parseOccurrenceParam } from "~/lib/scheduled-meeting";
import { fullName, formatDateShort, formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { useOsChrome } from "~/components/os-chrome";
import { SearchInput } from "~/components/ui/SearchInput";
import { LoadMore } from "~/components/ui/Pager";
import { fetchCursorPage, useLoadMore } from "~/hooks/useLoadMore";
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

// Lab-wide Attendance: access is by invitation, enforced by the feed query.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const core = await isCore(auth.user.sub, request);
  const { items, nextCursor } = await loadAttendanceFeed({ userId: auth.user.sub, core }, { q });
  return { events: items, nextCursor, q };
}

// Save (or clear) the absence note on one roster row. Writing is gated by the
// same organizer / Core / project-member rule that governs marking attendance —
// this page is otherwise read-only and open to everyone invited, so the gate is
// re-checked here rather than trusted from the loader's `canManage`.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  if (form.get("intent") !== "set-absence-note") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }
  const meetingId = String(form.get("meetingId") ?? "");
  const occurrenceStart = parseOccurrenceParam(form.get("occurrenceStart"));
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
    where: {
      scheduledMeetingId: meeting.id,
      userId,
      // Each occurrence keeps its own roster; a note is on one of them.
      ...(occurrenceStart ? { occurrenceStart } : {}),
    },
    data: { absenceNote },
  });
  if (updated.count === 0) {
    return Response.json({ error: "Not on this roster" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

type AttendanceEvent = AttendanceCard;
type Attendee = AttendanceCard["attendees"][number];

function startMs(e: AttendanceEvent, fallback: number): number {
  return e.startsAt ? Date.parse(e.startsAt) : fallback;
}

const fetchOlder = (q: string) => (cursor: string) => {
  const params = new URLSearchParams({ cursor });
  if (q) params.set("q", q);
  return fetchCursorPage<AttendanceEvent>(`/api/attendance/feed?${params}`);
};

export default function AttendancePage() {
  const data = useLoaderData<typeof loader>();
  const { pageTitle, panel } = useOsChrome();
  const [, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(data.q);
  // One control for every roster on the page: the cards all show the same kind
  // of list, so a per-card picker would just repeat itself down the page.
  const [sort, setSort] = useState<AttendeeSort>("name-asc");

  useEffect(() => {
    const next = query.trim();
    if (next === data.q) return;
    const id = window.setTimeout(
      () =>
        setSearchParams(next ? { q: next } : {}, { replace: true, preventScrollReset: true }),
      300,
    );
    return () => window.clearTimeout(id);
  }, [query, data.q, setSearchParams]);

  const { items: events, pager } = useLoadMore<AttendanceEvent>({
    items: data.events,
    nextCursor: data.nextCursor,
    fetchPage: fetchOlder(data.q),
    idOf: (e) => e.id,
    resetKey: data.q,
  });

  const { upcoming, past } = useMemo(() => {
    // Upcoming soonest-first (unscheduled last); past newest-first.
    const up = events
      .filter((e) => !e.isPast)
      .sort((a, b) => startMs(a, Number.POSITIVE_INFINITY) - startMs(b, Number.POSITIVE_INFINITY));
    const pa = events
      .filter((e) => e.isPast)
      .sort((a, b) => startMs(b, Number.NEGATIVE_INFINITY) - startMs(a, Number.NEGATIVE_INFINITY));
    return { upcoming: up, past: pa };
  }, [events]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className={pageTitle}>Attendance</h1>
      </header>

      {events.length === 0 && !data.q && !query ? (
        <div className={cn(panel, "p-10 text-center")}>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--area)_12%,transparent)]">
            <ClipboardCheck className="w-6 h-6 text-[var(--area)]" aria-hidden />
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
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SearchInput
              size="sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by event, organizer, project, or attendee…"
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
          {events.length === 0 ? (
            <div className={cn(panel, "px-4 py-8 text-center text-sm text-muted-foreground")}>
              No events match this search.
            </div>
          ) : (
            <>
              <EventSection title="Upcoming" events={upcoming} sort={sort} />
              <EventSection title="Past" events={past} sort={sort} />
              <LoadMore {...pager} />
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
  sort,
}: {
  title: string;
  events: AttendanceEvent[];
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
          <EventCard key={event.id} event={event} sort={sort} />
        ))}
      </ul>
    </section>
  );
}

function EventCard({
  event,
  sort,
}: {
  event: AttendanceEvent;
  sort: AttendeeSort;
}) {
  const tz = useUserTimeZone();
  const dialog = useDialog();
  const cancelFetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const pct = event.invited > 0 ? Math.round((event.checkedIn / event.invited) * 100) : 0;
  // Cards from loaded older pages are not refreshed by loader revalidation, so
  // a saved note is kept here to show it either way.
  const [notes, setNotes] = useState<Record<string, string | null>>({});
  const attendees = event.attendees.map((a) =>
    a.id in notes ? { ...a, absenceNote: notes[a.id] } : a,
  );
  const present = sortAttendees(attendees.filter((a) => a.present), sort);
  const missing = sortAttendees(attendees.filter((a) => !a.present), sort);
  const onNoteSaved = (userId: string, note: string | null) =>
    setNotes((prev) => ({ ...prev, [userId]: note }));

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
      action: `/api/scheduled-meetings/${event.meetingId}/cancel`,
    });
  }

  return (
    <li className="rounded-os-card bg-os-container/40 overflow-hidden">
      <div className="flex items-stretch hover:bg-muted/30 transition-colors">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left px-4 py-3.5 flex items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-os-accent/40"
        >
          <span className="mt-1 text-muted-foreground flex-shrink-0" aria-hidden>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading font-semibold text-foreground truncate">
              {event.title}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {[
                event.startsAt ? formatDateShort(new Date(event.startsAt), tz) : "No start time",
                `Organizer ${event.organizerName}`,
              ].join(" · ")}
            </p>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-xs">
                <div
                  className="h-full rounded-full bg-[var(--area)] transition-[width] duration-300"
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
            to={meetingOccurrenceHref(event.meetingId, event.occurrenceStart)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-[var(--area)] hover:bg-[color-mix(in_srgb,var(--area)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40"
            aria-label="Check in or mark attendance"
            title="Check in"
          >
            <ClipboardCheck className="w-4 h-4" />
          </Link>
          {event.canEdit && (
            <Menu
              align="right"
              trigger={
                <button
                  type="button"
                  aria-label="Event options"
                  disabled={cancelFetcher.state !== "idle"}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40 disabled:opacity-50"
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
        <EditMeetingModal meetingId={event.meetingId} onClose={() => setEditing(false)} />
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
                meetingId={event.meetingId}
                occurrenceStart={event.occurrenceStart}
                canManage={event.canManage}
                attendees={present}
                onNoteSaved={onNoteSaved}
                empty="Nobody has checked in yet."
              />
              <RosterColumn
                icon={UserX}
                title="Not submitted"
                tone="missing"
                meetingId={event.meetingId}
                occurrenceStart={event.occurrenceStart}
                canManage={event.canManage}
                attendees={missing}
                onNoteSaved={onNoteSaved}
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
  occurrenceStart,
  canManage,
  attendees,
  onNoteSaved,
  empty,
}: {
  icon: typeof UserCheck;
  title: string;
  tone: "present" | "missing";
  meetingId: string;
  occurrenceStart: string;
  canManage: boolean;
  attendees: Attendee[];
  onNoteSaved: (userId: string, note: string | null) => void;
  empty: string;
}) {
  const tz = useUserTimeZone();
  return (
    <div className="min-w-0">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-border/80">
        <Icon
          className={cn("w-3.5 h-3.5", tone === "present" ? "text-os-green" : "text-muted-foreground")}
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
                      occurrenceStart={occurrenceStart}
                      userId={a.id}
                      name={a.name}
                      note={a.absenceNote}
                      onSaved={(note) => onNoteSaved(a.id, note)}
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
