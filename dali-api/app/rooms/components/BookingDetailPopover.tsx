import { Link } from "react-router";
import { CalendarDays, Pencil, X } from "lucide-react";
import { AnchoredPopover } from "~/calendar/components/AnchoredPopover";
import { EventDetailBody, popoverActionBtn } from "~/calendar/components/WeekGrid";
import { cn } from "~/lib/cn";
import { timeLabel, type BookingAccess, type ScheduleItem } from "~/rooms/lib/timeline";

/** Date, times, and whether it repeats, on one line. */
export function bookingWhen(item: ScheduleItem) {
  const day = new Date(item.start).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  const when = `${day} · ${timeLabel(item.start)} to ${timeLabel(item.end)}`;
  return item.recurring ? `${when} · Repeats` : when;
}

export function BookingDetailPopover({
  item,
  roomName,
  anchor,
  access,
  onClose,
  onEdit,
  onCancel,
}: {
  item: ScheduleItem;
  roomName: string;
  anchor: DOMRect;
  access: BookingAccess;
  onClose: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const underway = Date.parse(item.start) <= Date.now();
  const hasActions = access.canEdit || access.canCancel || access.calendarHref;
  return (
    <AnchoredPopover
      anchor={anchor}
      onClose={onClose}
      ariaLabel={item.title}
      className="cal-surface w-[22rem] rounded-os-item p-4 text-sm"
    >
      <EventDetailBody
        title={item.title}
        timeRange={bookingWhen(item)}
        location={roomName}
        organizerName={`${item.organizer.firstName} ${item.organizer.lastName}`}
        onClose={onClose}
        footer={
          <>
            {access.note && <p className="mt-3.5 text-[13px] text-os-grey">{access.note}</p>}
            {hasActions && (
              <div className="mt-3.5 flex items-center gap-2">
                {access.canEdit && (
                  <button type="button" onClick={onEdit} className={popoverActionBtn}>
                    <Pencil className="h-3.5 w-3.5 text-os-grey" aria-hidden /> Edit
                  </button>
                )}
                {access.calendarHref && (
                  <Link to={access.calendarHref} className={popoverActionBtn}>
                    <CalendarDays className="h-3.5 w-3.5 text-os-grey" aria-hidden /> Open in Calendar
                  </Link>
                )}
                {access.canCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className={cn(popoverActionBtn, "ml-auto text-destructive hover:border-destructive/40")}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    {underway ? "End" : "Cancel"}
                    {item.recurring ? "…" : ""}
                  </button>
                )}
              </div>
            )}
          </>
        }
      />
    </AnchoredPopover>
  );
}
