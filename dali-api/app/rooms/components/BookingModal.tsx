import { useEffect, useState } from "react";
import { useOsChrome } from "~/components/os-chrome";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { DateField } from "~/components/ui/DateField";
import { TimeField } from "~/components/ui/TimeField";
import { Select } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { NO_REPEAT, RepeatField, repeatSpecToRRule, type RepeatSpec } from "~/calendar/components/RepeatField";
import { atTime, type ScheduleItem } from "~/rooms/lib/timeline";

export type BookingRoom = { id: string; name: string };

export type BookingDraft = {
  date: string;
  roomId: string;
  start: string;
  end: string;
  // Editing this item instead of booking. `scope` is null for a single booking.
  edit?: { item: ScheduleItem; scope: "this" | "all" | null };
};

const HEADINGS = {
  new: { title: "Book a room", subtitle: undefined },
  single: { title: "Edit booking", subtitle: undefined },
  this: { title: "Edit this time", subtitle: "The rest of the series stays the same." },
  all: { title: "Edit series", subtitle: "Changes apply to every date. The dates stay the same." },
};

export function BookingModal({
  rooms,
  initial,
  onClose,
  onSaved,
}: {
  rooms: BookingRoom[];
  initial: BookingDraft | null;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const chrome = useOsChrome();
  const toast = useToast();
  const [date, setDate] = useState("");
  const [roomId, setRoomId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<RepeatSpec>(NO_REPEAT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setDate(initial.date);
    setRoomId(initial.roomId);
    setStart(initial.start);
    setEnd(initial.end);
    setTitle(initial.edit?.item.bookedTitle ?? "");
    setRepeat(NO_REPEAT);
  }, [initial]);

  const edit = initial?.edit ?? null;
  const heading = HEADINGS[edit ? (edit.scope ?? "single") : "new"];
  const started = edit !== null && Date.parse(edit.item.start) <= Date.now();
  const onlyTime = edit?.scope === "this";
  const wholeSeries = edit?.scope === "all";

  const valid = date !== "" && start !== "" && end !== "" && start < end;
  const rrule = !edit && start ? repeatSpecToRRule(repeat, `${date}T${start}`) : null;
  // The server also rejects a never-ending series; catching it here just
  // saves the round trip.
  const repeatNeedsEnd = rrule !== null && repeat.end.type === "never";

  const send = () => {
    const startAt = atTime(date, start).toISOString();
    const endAt = atTime(date, end).toISOString();
    if (!edit || !initial) {
      return fetch(`/api/rooms/${roomId}/bookings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: startAt,
          end: endAt,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(rrule ? { recurrenceRule: rrule } : {}),
        }),
      });
    }
    // These fields hold whole minutes, but a booking made at the door doesn't
    // start on one, so an untouched field keeps the exact time it came with.
    const sameDay = date === initial.date;
    return fetch(`/api/room-bookings/${edit.item.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: sameDay && start === initial.start ? edit.item.start : startAt,
        end: sameDay && end === initial.end ? edit.item.end : endAt,
        ...(onlyTime ? {} : { roomId, title: title.trim() || null }),
        ...(edit.scope ? { scope: edit.scope, occurrenceStart: edit.item.occurrenceStart } : {}),
      }),
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || repeatNeedsEnd) return;
    setSaving(true);
    try {
      const res = await send();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? (edit ? "Couldn't save the booking." : "Couldn't book the room."));
        return;
      }
      const roomName = rooms.find((r) => r.id === roomId)?.name ?? "the room";
      if (edit) toast.success(wholeSeries ? "Series updated." : "Booking updated.");
      else toast.success(rrule ? `Booked ${roomName} for the series.` : `Booked ${roomName}.`);
      onSaved(date);
    } catch {
      toast.error(edit ? "Couldn't save the booking." : "Couldn't book the room.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={initial !== null} onClose={onClose} labelledBy="book-room-title">
      <ModalHeader titleId="book-room-title" title={heading.title} subtitle={heading.subtitle} onClose={onClose} />
      <form onSubmit={submit} className={cn(chrome.formClass, "flex flex-col gap-5")}>
        <div className="os-field-group">
          <span className="os-field-label">Room</span>
          <Select
            value={roomId}
            options={rooms.map((r) => ({ value: r.id, label: r.name }))}
            onChange={setRoomId}
            ariaLabel="Room"
            disabled={onlyTime || started}
            buttonClassName={chrome.formTrigger}
          />
        </div>
        <div className="os-field-group">
          <span className="os-field-label">Date</span>
          <DateField
            mode="date"
            ariaLabel="Date"
            value={date}
            onChange={(v) => v && setDate(v)}
            disabled={wholeSeries || started}
            buttonClassName={chrome.formTrigger}
          />
        </div>
        <div className="os-field-row">
          <div className="os-field-group">
            <span className="os-field-label">Starts</span>
            <TimeField value={start} onChange={setStart} ariaLabel="Starts" className="w-full" disabled={started} />
          </div>
          <div className="os-field-group">
            <span className="os-field-label">Ends</span>
            <TimeField value={end} onChange={setEnd} ariaLabel="Ends" className="w-full" />
          </div>
        </div>
        {start !== "" && end !== "" && start >= end && (
          <p className="text-xs text-destructive">The end has to be after the start, on the same day.</p>
        )}
        {!edit && start !== "" && (
          <div className="os-field-group">
            <RepeatField
              value={repeat}
              onChange={setRepeat}
              anchorLocal={`${date}T${start}`}
              labelClassName="os-field-label"
              fieldClassName={chrome.formTrigger}
            />
            {repeatNeedsEnd && (
              <p className="text-xs text-destructive">
                A repeating booking needs an end date or a number of times.
              </p>
            )}
          </div>
        )}
        <label className="os-field-group">
          <span>What for</span>
          <input
            type="text"
            maxLength={200}
            placeholder="Optional"
            value={title}
            disabled={onlyTime}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <ModalFooter onCancel={onClose}>
          <button type="submit" className="os-btn-primary" disabled={!valid || repeatNeedsEnd || saving}>
            {edit ? "Save" : "Book"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
