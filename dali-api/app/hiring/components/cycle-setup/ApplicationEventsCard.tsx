import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Select, Combobox, Menu, Tooltip, type SelectOption } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { formatDateShort, formatSessionWhen } from "~/lib/display";
import { APPLICATION_TZ, getZonedParts, zonedDateTimeLocalToUtc } from "~/lib/timezone";
import { cn } from "~/lib/cn";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { Pill, SetupCard, rowTrigger } from "./SetupCard";

// Help hours, socials and info sessions Core runs on a hiring cycle — setup,
// manual announcement send, and attendance (QR self check-in or hand-marked).
// Mutations go through /api/hiring/events/* via fetchers; the cycle page's
// loader revalidates after each one, so events/checkIns always come back
// through props rather than local state the card would have to reconcile.

export type EventKind = "HelpHour" | "Social" | "InfoSession" | "Other";

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  HelpHour: "Help hour",
  Social: "Social",
  InfoSession: "Info session",
  Other: "Other",
};

const KIND_OPTIONS: SelectOption<EventKind>[] = (
  Object.keys(EVENT_KIND_LABELS) as EventKind[]
).map((value) => ({ value, label: EVENT_KIND_LABELS[value] }));

export type HiringEventRow = {
  id: string;
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  checkInOpenAt: string | null;
  announcementSentAt: string | null;
  attendeeCount: number;
};

export type EventCheckIn = { checkInUrl: string; checkInQrSvg: string };

type AnnouncementResult =
  | { outcome: "not_configured" }
  | { outcome: "sent"; attempted: number; succeeded: number; failed: number; alreadySent: number };

type RosterEntry = {
  userId: string;
  name: string;
  email: string | null;
  present: boolean;
  markedAt: string | null;
  applicant: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant -> "yyyy-MM-ddTHH:mm" wall-clock in the lab's timezone, for a
 *  DateField's datetime-local value (events are scheduled in Eastern Time). */
function toLocalInput(iso: string): string {
  const { year, month, day, hour, minute } = getZonedParts(new Date(iso), APPLICATION_TZ);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

function announcementMessage(result: AnnouncementResult): { message: string; variant: "success" | "info" | "error" } {
  if (result.outcome === "not_configured") {
    return { message: "Template not bound", variant: "error" };
  }
  if (result.succeeded === 0 && result.attempted > 0 && result.alreadySent === result.attempted) {
    return { message: "Already sent to everyone", variant: "info" };
  }
  return {
    message: `Announcement sent to ${result.succeeded} applicant${result.succeeded === 1 ? "" : "s"}`,
    variant: "success",
  };
}

export function ApplicationEventsCard({
  cycleId,
  events,
  announcementTemplateBound,
  checkIns,
}: {
  cycleId: string;
  events: HiringEventRow[];
  announcementTemplateBound: boolean;
  checkIns: Record<string, EventCheckIn>;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <SetupCard
      title="Application events"
      description="Help hours, socials and info sessions for this cycle."
      action={
        !creating && (
          <button type="button" onClick={() => setCreating(true)} className={buttonClasses("secondary", "sm")}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New event
          </button>
        )
      }
    >
      {creating && (
        <EventForm mode="create" cycleId={cycleId} onClose={() => setCreating(false)} />
      )}
      {events.length === 0 && !creating && (
        <p className="text-sm text-os-grey">
          No events yet. Create a help hour or social and email everyone who started an application.
        </p>
      )}
      {events.length > 0 && (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <EventRow
              key={event.id}
              cycleId={cycleId}
              event={event}
              announcementTemplateBound={announcementTemplateBound}
              checkIn={checkIns[event.id] ?? null}
            />
          ))}
        </ul>
      )}
    </SetupCard>
  );
}

function EventRow({
  cycleId,
  event,
  announcementTemplateBound,
  checkIn,
}: {
  cycleId: string;
  event: HiringEventRow;
  announcementTemplateBound: boolean;
  checkIn: EventCheckIn | null;
}) {
  const tz = useUserTimeZone();
  const dialog = useDialog();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const deleteFetcher = useFetcher<{ error?: string }>();
  const checkInFetcher = useFetcher<{ error?: string }>();
  const announceFetcher = useFetcher<AnnouncementResult & { error?: string }>();
  const rosterFetcher = useFetcher<RosterEntry[]>();
  const walkInFetcher = useFetcher<{ error?: string }>();

  const eventsUrl = `/api/hiring/events/${event.id}`;
  const checkInOpen = event.checkInOpenAt != null;

  useEffect(() => {
    if (announceFetcher.state === "idle" && announceFetcher.data) {
      if (announceFetcher.data.error) {
        toast.error(announceFetcher.data.error);
      } else {
        const { message, variant } = announcementMessage(announceFetcher.data);
        toast[variant](message);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announceFetcher.state, announceFetcher.data]);

  useEffect(() => {
    if (walkInFetcher.state === "idle" && walkInFetcher.data && !walkInFetcher.data.error) {
      rosterFetcher.load(eventsUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkInFetcher.state, walkInFetcher.data]);

  async function handleDelete() {
    const ok = await dialog.confirm({
      title: `Delete "${event.title}"?`,
      description: "This removes the event and its attendance records. Applicants already emailed keep the invite in their inbox.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    deleteFetcher.submit({ intent: "delete" }, { method: "post", action: eventsUrl, encType: "application/json" });
  }

  function toggleCheckIn() {
    checkInFetcher.submit(
      { intent: "set-check-in", open: !checkInOpen },
      { method: "post", action: eventsUrl, encType: "application/json" },
    );
  }

  function sendAnnouncement() {
    announceFetcher.submit(
      { intent: "send-announcement" },
      { method: "post", action: eventsUrl, encType: "application/json" },
    );
  }

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !rosterFetcher.data) rosterFetcher.load(eventsUrl);
  }

  const roster = rosterFetcher.data ?? [];
  const attendeeRows: AttendanceRow[] = roster.map((r) => ({
    userId: r.userId,
    name: r.applicant ? r.name : `${r.name} · Not an applicant yet`,
    present: r.present,
  }));
  const walkInCandidates = roster.filter((r) => r.applicant && !r.present);

  const sentResult = announceFetcher.data && !("error" in announceFetcher.data) ? announceFetcher.data : null;
  const announcementPill =
    sentResult && sentResult.outcome === "sent"
      ? `Sent to ${sentResult.succeeded}`
      : event.announcementSentAt
        ? `Announced ${formatDateShort(event.announcementSentAt, tz)}`
        : null;

  if (editing) {
    return (
      <li>
        <EventForm mode="edit" cycleId={cycleId} event={event} onClose={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-os-item bg-os-well px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{event.title}</span>
            <Pill tone="accent">{EVENT_KIND_LABELS[event.kind]}</Pill>
            {announcementPill && <Pill tone="success">{announcementPill}</Pill>}
          </div>
          <p className="text-xs text-os-grey">
            {formatSessionWhen(event.startsAt, event.endsAt, tz)}
            {event.location ? ` · ${event.location}` : ""}
            {` · ${event.attendeeCount} attended`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleCheckIn}
            disabled={checkInFetcher.state !== "idle"}
            className={buttonClasses(checkInOpen ? "primary" : "secondary", "sm")}
          >
            {checkInOpen ? "Close check-in" : "Open check-in"}
          </button>
          <Tooltip content={announcementTemplateBound ? null : "Bind the Application event announcement template first"}>
            <button
              type="button"
              onClick={sendAnnouncement}
              disabled={!announcementTemplateBound || announceFetcher.state !== "idle"}
              className={buttonClasses("secondary", "sm")}
            >
              {announceFetcher.state !== "idle"
                ? "Sending…"
                : event.announcementSentAt
                  ? "Resend"
                  : "Send announcement"}
            </button>
          </Tooltip>
          <button type="button" onClick={toggleExpanded} aria-expanded={expanded} className={buttonClasses("secondary", "sm")}>
            Attendance
          </button>
          <Menu
            align="right"
            ariaLabel="Event actions"
            trigger={
              <button type="button" className={buttonClasses("secondary", "sm")} aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            }
          >
            <Menu.Item icon={<Pencil className="h-4 w-4" aria-hidden />} onSelect={() => setEditing(true)}>
              Edit
            </Menu.Item>
            <Menu.Item
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              destructive
              disabled={deleteFetcher.state !== "idle"}
              onSelect={() => void handleDelete()}
            >
              Delete
            </Menu.Item>
          </Menu>
        </div>
      </div>

      {deleteFetcher.data?.error && <p className="text-xs text-red-700">{deleteFetcher.data.error}</p>}
      {checkInFetcher.data?.error && <p className="text-xs text-red-700">{checkInFetcher.data.error}</p>}

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-os-container pt-3">
          {checkIn && (
            <CheckInPanel
              meetingId={event.id}
              meetingLabel={event.title}
              viewerInvited={false}
              initialPresent={false}
              checkInUrl={checkIn.checkInUrl}
              checkInQrSvg={checkIn.checkInQrSvg}
              checkInEndpoint={`/api/hiring/events/${event.id}/check-in`}
              qrPdfHref={`/api/hiring/events/${event.id}/check-in-qr.pdf`}
            />
          )}
          <div className="w-full max-w-xs">
            <Combobox
              ariaLabel="Add a walk-in"
              value=""
              placeholder="Add walk-in"
              emptyLabel={roster.length === 0 ? "Loading…" : "No applicants left to add"}
              options={walkInCandidates.map((c) => ({ value: c.userId, label: c.name }))}
              onChange={(userId) => {
                if (userId) {
                  walkInFetcher.submit(
                    { userId, present: true },
                    { method: "post", action: eventsUrl, encType: "application/json" },
                  );
                }
              }}
            />
          </div>
          <AttendanceChecklist
            meetingId={event.id}
            occurrenceStart={event.startsAt}
            meetingLabel={event.title}
            canEdit
            canNote={false}
            canScan={false}
            plain
            attendees={attendeeRows}
            endpoint={eventsUrl}
          />
        </div>
      )}
    </li>
  );
}

function EventForm({
  mode,
  cycleId,
  event,
  onClose,
}: {
  mode: "create" | "edit";
  cycleId: string;
  event?: HiringEventRow;
  onClose: () => void;
}) {
  const { formClass, fieldLabel, formTrigger } = useOsChrome();
  const fetcher = useFetcher<{ error?: string }>();
  const trigger = rowTrigger(formTrigger);

  const [kind, setKind] = useState<EventKind>(event?.kind ?? "HelpHour");
  const [title, setTitle] = useState(event?.title ?? "");
  const [startsAt, setStartsAt] = useState(event ? toLocalInput(event.startsAt) : "");
  const [endsAt, setEndsAt] = useState(event ? toLocalInput(event.endsAt) : "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    const startsAtUtc = zonedDateTimeLocalToUtc(startsAt, APPLICATION_TZ);
    const endsAtUtc = zonedDateTimeLocalToUtc(endsAt, APPLICATION_TZ);
    if (!title.trim()) return setValidationError("Title is required");
    if (!startsAtUtc || !endsAtUtc) return setValidationError("Pick a start and end time");
    if (endsAtUtc.getTime() <= startsAtUtc.getTime()) return setValidationError("End time must be after start time");

    const payload = {
      kind,
      title: title.trim(),
      startsAt: startsAtUtc.toISOString(),
      endsAt: endsAtUtc.toISOString(),
      location: location.trim() || null,
    };
    if (mode === "create") {
      fetcher.submit(payload, {
        method: "post",
        action: `/api/hiring/cycles/${cycleId}/events`,
        encType: "application/json",
      });
    } else {
      fetcher.submit(
        { intent: "update", ...payload },
        { method: "post", action: `/api/hiring/events/${event!.id}`, encType: "application/json" },
      );
    }
  }

  return (
    <form onSubmit={submit} className={cn(formClass, "flex flex-col gap-3 rounded-os-item bg-os-well p-4")}>
      <div className="flex flex-wrap gap-3">
        <label className={cn(fieldLabel, "min-w-[12rem] flex-1")}>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Application help hour"
            required
          />
        </label>
        <label className={cn(fieldLabel, "w-44")}>
          Kind
          <Select value={kind} onChange={setKind} options={KIND_OPTIONS} ariaLabel="Kind" buttonClassName={trigger} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={cn(fieldLabel, "w-56")}>
          Starts
          <DateField
            mode="datetime-local"
            value={startsAt}
            onChange={setStartsAt}
            ariaLabel="Starts"
            buttonClassName={trigger}
          />
        </label>
        <label className={cn(fieldLabel, "w-56")}>
          Ends
          <DateField mode="datetime-local" value={endsAt} onChange={setEndsAt} ariaLabel="Ends" buttonClassName={trigger} />
        </label>
        <label className={cn(fieldLabel, "min-w-[12rem] flex-1")}>
          Location
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="DALI Lab, Sudikoff"
          />
        </label>
      </div>
      {(validationError || fetcher.data?.error) && (
        <p className="text-xs text-red-700">{validationError ?? fetcher.data?.error}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} disabled={submitting} className={buttonClasses("secondary", "sm")}>
          Cancel
        </button>
        <button type="submit" disabled={submitting} className={buttonClasses("primary", "sm")}>
          {submitting ? "Saving…" : mode === "create" ? "Create event" : "Save"}
        </button>
      </div>
    </form>
  );
}
