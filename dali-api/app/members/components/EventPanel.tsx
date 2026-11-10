import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { Check, ExternalLink, MapPin, Video, X } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Button, buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { DateBlock } from "~/members/components/CommunityColumn";
import type { CommunityEvent } from "~/members/lib/community.server";
import { eventWhenFull } from "~/members/lib/community-view";

export function EventPanel({
  event,
  tz,
  onClose,
  onEdit,
}: {
  event: CommunityEvent;
  tz: string;
  onClose: () => void;
  onEdit: (event: CommunityEvent) => void;
}) {
  const rsvp = useFetcher();
  const cancel = useFetcher();
  const confirmSubmit = useConfirmSubmit();
  const toast = useToast();
  useEffect(() => {
    if (rsvp.data?.ok === false) toast.error(rsvp.data.error);
  }, [rsvp.data, toast]);
  useEffect(() => {
    if (!cancel.data) return;
    if (cancel.data.ok) {
      toast.success("Event cancelled.");
      onClose();
    } else {
      toast.error(cancel.data.error);
    }
  }, [cancel.data, toast, onClose]);
  const pending = rsvp.formData?.get("going");
  const going = pending != null ? pending === "true" : event.viewerGoing;
  const rsvpForm = (next: boolean) => ({ intent: "rsvp", eventId: event.id, going: String(next) });

  return (
    <aside
      aria-label="Event"
      className="absolute inset-x-3 bottom-3 z-10 flex max-h-[70%] flex-col overflow-hidden rounded-os-card bg-os-card shadow-xl lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:max-h-none lg:w-[360px]"
    >
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-start gap-3">
          <DateBlock startsAt={event.startsAt} tz={tz} source={event.source} />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">{event.title}</h2>
            <p className="mt-0.5 text-xs text-os-grey">{eventWhenFull(event, tz)}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-os-grey">
              {event.online ? <Video className="h-3.5 w-3.5 shrink-0" /> : <MapPin className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{event.address ? `${event.location}, ${event.address}` : event.location}</span>
            </p>
          </div>
          <IconButton label="Close event" icon={X} onClick={onClose} />
        </div>

        {event.host && (
          <div className="mt-4 flex items-center gap-2.5">
            <Avatar photoUrl={event.host.photoUrl} name={event.host.name} size="md" userId={event.host.id} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{event.host.name}</p>
              <p className="truncate text-xs text-os-grey">{event.host.currentJob ?? "Host"}</p>
            </div>
            <Link to={`/members/${event.host.id}`} className={buttonClasses("secondary", "sm")}>
              View profile
            </Link>
          </div>
        )}

        {event.meetingUrl && event.online && (
          <a
            href={event.meetingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs text-os-accent hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Join link
          </a>
        )}

        {event.description && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">{event.description}</p>
        )}

        <section className="mt-4">
          <h3 className="text-xs font-semibold text-os-grey">{event.goingCount} going</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {event.attendees.map((a) => (
              <li key={a.id}>
                <Link to={`/members/${a.id}`} className="flex items-center gap-2 hover:underline">
                  <Avatar photoUrl={a.photoUrl} name={a.name} size="compact" />
                  <span className="min-w-0 truncate text-sm text-foreground">{a.name}</span>
                  {a.reason && <span className="truncate text-xs text-os-accent">{a.reason}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-os-container p-3">
        {going ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-os-green">
              <Check className="h-4 w-4" aria-hidden />
              You're going
            </span>
            <a href={`/community/events/${event.id}/calendar.ics`} className={buttonClasses("secondary", "sm")}>
              Add to calendar
            </a>
            <Button variant="ghost" size="sm" onClick={() => rsvp.submit(rsvpForm(false), { method: "post" })}>
              Can't go
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => rsvp.submit(rsvpForm(true), { method: "post" })}>
            Going
          </Button>
        )}
        {event.canManage && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => onEdit(event)}>
              Edit
            </Button>
            <cancel.Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Cancel this event?",
                description: "It comes off the map and people who said they are going will not see it.",
                confirmLabel: "Cancel event",
                cancelLabel: "Keep event",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="cancel-event" />
              <input type="hidden" name="eventId" value={event.id} />
              <Button type="submit" variant="destructive" size="sm">
                Cancel event
              </Button>
            </cancel.Form>
          </div>
        )}
      </footer>
    </aside>
  );
}
