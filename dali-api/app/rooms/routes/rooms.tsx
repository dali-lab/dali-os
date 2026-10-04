// General ▸ Rooms. Pick a day, see every DALI room's bookings and meetings side
// by side on one day timeline, and book a free slot. The schedule is fetched client-side
// for the browser's local day (the same /api/rooms/:id/schedule window the
// iPad door display uses), so the server's timezone never matters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Route } from "./+types/rooms";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { useOsChrome } from "~/components/os-chrome";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { DateField } from "~/components/ui/DateField";
import { TimeField } from "~/components/ui/TimeField";
import { IconButton } from "~/components/ui/IconButton";
import { Select } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Rooms · DALI OS" }];

export const handle = {
  breadcrumb: () => "Rooms",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (auth.user.type === "applicant") throw redirect("/portal");

  const rooms = await prisma.room.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, description: true, capacity: true },
    orderBy: { name: "asc" },
  });
  return { rooms, userId: auth.user.sub };
}

type ScheduleItem = {
  kind: "booking" | "meeting";
  id: string;
  title: string;
  start: string;
  end: string;
  organizer: { id: string; firstName: string; lastName: string };
  isEvent: boolean;
};

// The visible day, in local hours. Items outside it are clipped to the edges.
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const HOUR_PX = 56;
const SNAP_MIN = 30;
// A drag snaps finer than a click, like the iPad timeline.
const DRAG_SNAP_MIN = 15;
// Less movement than this is a click, not a drag.
const DRAG_THRESHOLD_MIN = 10;

// A room's column and its header share this so they line up; the floor keeps a
// booking's title readable when many rooms sit side by side.
const ROOM_COLUMN = "min-w-[11rem] flex-1 basis-0";

type RoomInfo = { id: string; name: string; description: string | null; capacity: number | null };
type Draft = { roomId: string; start: string; end: string };

const pad = (n: number) => String(n).padStart(2, "0");

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localDay(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const start = new Date(y!, m! - 1, d!);
  const end = new Date(y!, m! - 1, d! + 1);
  return { start, end };
}

function shiftDay(dateKey: string, days: number) {
  const { start } = localDay(dateKey);
  start.setDate(start.getDate() + days);
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

function atTime(dateKey: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const { start } = localDay(dateKey);
  start.setHours(h!, m!, 0, 0);
  return start;
}

function hhmm(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function RoomsPage() {
  const { rooms, userId } = useLoaderData<typeof loader>();
  const chrome = useOsChrome();
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();

  const dateKey = params.get("date") ?? todayKey();

  const [itemsByRoom, setItemsByRoom] = useState<Record<string, ScheduleItem[]> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const setDate = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("date", value);
    setParams(next, { replace: true });
  };

  // Flipping days quickly overlaps requests; only the latest one lands.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const { start, end } = localDay(dateKey);
    const qs = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const results = await Promise.all(
      rooms.map(async (r) => {
        const res = await fetch(`/api/rooms/${r.id}/schedule?${qs}`, { credentials: "include" }).catch(
          () => null,
        );
        const json = await res?.json().catch(() => null);
        return res?.ok && Array.isArray(json?.items) ? (json.items as ScheduleItem[]) : null;
      }),
    );
    if (seq !== loadSeq.current) return;
    if (results.some((r) => r === null)) toast.error("Couldn't load every room's schedule.");
    setItemsByRoom(Object.fromEntries(rooms.map((r, i) => [r.id, results[i] ?? []])));
  }, [rooms, dateKey, toast]);

  useEffect(() => {
    setItemsByRoom(null);
    void load();
  }, [load]);

  const openDraftAt = (
    roomId: string,
    start: Date,
    end = new Date(start.getTime() + 60 * 60_000),
  ) => {
    setDraft({ roomId, start: hhmm(start), end: hhmm(end) });
  };

  const openDraftNext = () => {
    const now = new Date();
    const base = dateKey === todayKey() ? now : atTime(dateKey, `${pad(9)}:00`);
    const snapped = new Date(base);
    snapped.setSeconds(0, 0);
    snapped.setMinutes(Math.ceil(snapped.getMinutes() / SNAP_MIN) * SNAP_MIN);
    openDraftAt(rooms[0]!.id, snapped);
  };

  const cancelBooking = async (item: ScheduleItem) => {
    const underway = new Date(item.start) <= new Date();
    const ok = await dialog.confirm({
      title: underway ? "End this booking now?" : "Cancel this booking?",
      description: underway ? "The rest of the slot frees up for others." : undefined,
      confirmLabel: underway ? "End now" : "Cancel booking",
      cancelLabel: "Keep it",
      tone: "destructive",
    });
    if (!ok) return;
    const res = await fetch(`/api/room-bookings/${item.id}/cancel`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? "Couldn't cancel the booking.");
      return;
    }
    toast.success(underway ? "Booking ended." : "Booking cancelled.");
    void load();
  };

  if (rooms.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className={chrome.pageTitle}>Rooms</h1>
        <p className={chrome.bodyText}>No rooms can be booked yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className={chrome.pageTitle}>Rooms</h1>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <IconButton label="Previous day" icon={ChevronLeft} onClick={() => setDate(shiftDay(dateKey, -1))} />
            <DateField
              mode="date"
              ariaLabel="Day"
              value={dateKey}
              onChange={(v) => v && setDate(v)}
              className="w-44"
              buttonClassName={chrome.formTrigger}
            />
            <IconButton label="Next day" icon={ChevronRight} onClick={() => setDate(shiftDay(dateKey, 1))} />
          </div>
          {dateKey !== todayKey() && (
            <button type="button" className="os-btn-ghost" onClick={() => setDate(todayKey())}>
              Today
            </button>
          )}
          <button type="button" className="os-btn-primary ml-auto" onClick={openDraftNext}>
            Book
          </button>
        </div>

        <section className={cn(chrome.panel, chrome.panelPad)}>
          <DayTimeline
            dateKey={dateKey}
            rooms={rooms}
            itemsByRoom={itemsByRoom}
            userId={userId}
            onPickSlot={openDraftAt}
            onCancel={cancelBooking}
          />
        </section>
      </div>

      <BookingModal
        rooms={rooms}
        dateKey={dateKey}
        initial={draft}
        onClose={() => setDraft(null)}
        onBooked={() => {
          setDraft(null);
          void load();
        }}
      />
    </div>
  );
}

// Every room's day side by side: one shared hour axis, then a column per room.
// The grid is its own scroller (the shell's page scroll can't hold a sticky
// row), so the room names stay put while the hours scroll under them, and the
// hour axis stays put when many rooms scroll sideways.
function DayTimeline({
  dateKey,
  rooms,
  itemsByRoom,
  userId,
  onPickSlot,
  onCancel,
}: {
  dateKey: string;
  rooms: RoomInfo[];
  itemsByRoom: Record<string, ScheduleItem[]> | null;
  userId: string;
  onPickSlot: (roomId: string, start: Date, end?: Date) => void;
  onCancel: (item: ScheduleItem) => void;
}) {
  // Unset until mounted: the server renders in its own timezone, and React
  // keeps a server-rendered style through hydration, so a "now" line placed
  // there would sit hours off until the next tick.
  const [mountedNow, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const hours = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    [],
  );

  return (
    <div className="max-h-[calc(100dvh-18rem)] min-h-[20rem] overflow-auto">
      <div className="min-w-fit">
        <div className="sticky top-0 z-30 flex bg-os-card pb-2">
          <div className="sticky left-0 z-10 w-16 shrink-0 bg-os-card" />
          {rooms.map((r) => (
            <div key={r.id} className={cn(ROOM_COLUMN, "px-3")}>
              <h2 className="truncate font-heading text-base font-semibold text-foreground">{r.name}</h2>
              <p className="truncate text-xs text-os-muted" title={r.description ?? undefined}>
                {[r.capacity ? `Seats ${r.capacity}` : null, r.description].filter(Boolean).join(" · ") ||
                  "\u00a0"}
              </p>
            </div>
          ))}
        </div>
        <div className="relative mt-2 flex" style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX }}>
          <div className="sticky left-0 z-20 w-16 shrink-0 bg-os-card">
            {hours.map((h) => (
              <span
                key={h}
                className="absolute -translate-y-1/2 text-xs text-os-muted"
                style={{ top: (h - DAY_START_HOUR) * HOUR_PX }}
              >
                {new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" })}
              </span>
            ))}
          </div>
          {rooms.map((r) => (
            <RoomColumn
              key={r.id}
              dateKey={dateKey}
              hours={hours}
              items={itemsByRoom ? (itemsByRoom[r.id] ?? []) : null}
              userId={userId}
              mountedNow={mountedNow}
              onPickSlot={(start, end) => onPickSlot(r.id, start, end)}
              onCancel={onCancel}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RoomColumn({
  dateKey,
  hours,
  items,
  userId,
  mountedNow,
  onPickSlot,
  onCancel,
}: {
  dateKey: string;
  hours: number[];
  items: ScheduleItem[] | null;
  userId: string;
  mountedNow: number | null;
  onPickSlot: (start: Date, end?: Date) => void;
  onCancel: (item: ScheduleItem) => void;
}) {
  const chrome = useOsChrome();
  const now = mountedNow ?? Date.now();

  const dayStart = atTime(dateKey, `${pad(DAY_START_HOUR)}:00`).getTime();
  const dayEnd = atTime(dateKey, `${pad(DAY_END_HOUR)}:00`).getTime();
  const yFor = (t: number) =>
    ((Math.min(Math.max(t, dayStart), dayEnd) - dayStart) / 3_600_000) * HOUR_PX;

  // Minutes past DAY_START_HOUR, measured from the top of the timeline column.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dayMinutes = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const minutesAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(Math.max(((e.clientY - rect.top) / HOUR_PX) * 60, 0), dayMinutes);
  };
  const dragging = drag !== null && Math.abs(drag.to - drag.from) >= DRAG_THRESHOLD_MIN;
  const dragRange = drag && {
    from: Math.floor(Math.min(drag.from, drag.to) / DRAG_SNAP_MIN) * DRAG_SNAP_MIN,
    to: Math.ceil(Math.max(drag.from, drag.to) / DRAG_SNAP_MIN) * DRAG_SNAP_MIN,
  };
  const at = (minutes: number) => new Date(dayStart + minutes * 60_000);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = minutesAt(e);
    setDrag({ from: m, to: m });
  };

  const endDrag = () => {
    if (!drag || !dragRange) return;
    setDrag(null);
    if (dragging) {
      if (at(dragRange.to).getTime() <= now) return;
      onPickSlot(at(dragRange.from), at(dragRange.to));
      return;
    }
    const start = at(Math.floor(drag.from / SNAP_MIN) * SNAP_MIN);
    if (start.getTime() + SNAP_MIN * 60_000 < now) return;
    onPickSlot(start);
  };

  return (
    <div
      role="presentation"
      className={cn(ROOM_COLUMN, "relative cursor-pointer select-none border-l border-os-container")}
      onPointerDown={startDrag}
      onPointerMove={(e) => drag && setDrag({ ...drag, to: minutesAt(e) })}
      onPointerUp={endDrag}
      onPointerCancel={() => setDrag(null)}
    >
      {hours.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute inset-x-0 border-t border-os-container"
          style={{ top: (h - DAY_START_HOUR) * HOUR_PX }}
        />
      ))}

      {items === null && <p className={cn(chrome.bodyText, "p-3")}>Loading…</p>}

      {items?.map((item) => {
        const start = new Date(item.start).getTime();
        const end = new Date(item.end).getTime();
        if (end <= dayStart || start >= dayEnd) return null;
        const top = yFor(start);
        const height = Math.max(yFor(end) - top, 22);
        const mine = item.kind === "booking" && item.organizer.id === userId && end > now;
        const short = height <= 36;
        return (
          <div
            key={`${item.kind}-${item.id}-${item.start}`}
            className={cn(
              "absolute inset-x-2 overflow-hidden rounded-[10px] border px-3 text-sm",
              short ? "py-0.5" : "py-1.5",
              item.kind === "meeting"
                ? "border-os-accent/40 bg-os-accent/15 text-foreground"
                : "border-os-container bg-os-well text-foreground",
            )}
            style={{ top, height }}
          >
            <div className={cn("flex justify-between gap-2", short ? "h-full items-center" : "items-start")}>
              <div className="min-w-0">
                <p className="truncate font-medium">{item.title}</p>
                {height > 36 && (
                  <p className="truncate text-xs text-os-grey">
                    {timeLabel(item.start)} to {timeLabel(item.end)} · {item.organizer.firstName}{" "}
                    {item.organizer.lastName}
                  </p>
                )}
              </div>
              {mine && (
                <button
                  type="button"
                  onClick={() => onCancel(item)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-os-card px-2.5 py-0.5 text-xs font-medium text-os-grey transition-colors hover:bg-os-container hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {start <= now ? "End" : "Cancel"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {dragging && dragRange && (
        <div
          className="pointer-events-none absolute inset-x-2 z-10 rounded-[10px] border border-os-accent bg-os-accent/15 px-3 py-1.5 text-sm font-medium text-foreground"
          style={{ top: (dragRange.from / 60) * HOUR_PX, height: ((dragRange.to - dragRange.from) / 60) * HOUR_PX }}
        >
          {timeLabel(at(dragRange.from).toISOString())} to {timeLabel(at(dragRange.to).toISOString())}
        </div>
      )}

      {mountedNow !== null && dateKey === todayKey() && now > dayStart && now < dayEnd && (
        <div
          className="pointer-events-none absolute inset-x-0 h-0.5 bg-[var(--os-danger-ink)]"
          style={{ top: yFor(now) }}
          aria-hidden
        />
      )}
    </div>
);
}

function BookingModal({
  rooms,
  dateKey,
  initial,
  onClose,
  onBooked,
}: {
  rooms: RoomInfo[];
  dateKey: string;
  initial: Draft | null;
  onClose: () => void;
  onBooked: () => void;
}) {
  const chrome = useOsChrome();
  const toast = useToast();
  const [roomId, setRoomId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setRoomId(initial.roomId);
    setStart(initial.start);
    setEnd(initial.end);
    setTitle("");
  }, [initial]);

  const valid = start !== "" && end !== "" && start < end;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/bookings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: atTime(dateKey, start).toISOString(),
          end: atTime(dateKey, end).toISOString(),
          ...(title.trim() ? { title: title.trim() } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't book the room.");
        return;
      }
      toast.success(`Booked ${rooms.find((r) => r.id === roomId)?.name ?? "the room"}.`);
      onBooked();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={initial !== null} onClose={onClose} labelledBy="book-room-title">
      <ModalHeader
        titleId="book-room-title"
        title="Book a room"
        subtitle={localDay(dateKey).start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        onClose={onClose}
      />
      <form onSubmit={submit} className={cn(chrome.formClass, "flex flex-col gap-5")}>
        <div className="os-field-group">
          <span className="os-field-label">Room</span>
          <Select
            value={roomId}
            options={rooms.map((r) => ({ value: r.id, label: r.name }))}
            onChange={setRoomId}
            ariaLabel="Room"
            buttonClassName={chrome.formTrigger}
          />
        </div>
        <div className="os-field-row">
          <div className="os-field-group">
            <span className="os-field-label">Starts</span>
            <TimeField value={start} onChange={setStart} ariaLabel="Starts" className="w-full" />
          </div>
          <div className="os-field-group">
            <span className="os-field-label">Ends</span>
            <TimeField value={end} onChange={setEnd} ariaLabel="Ends" className="w-full" />
          </div>
        </div>
        <label className="os-field-group">
          <span>What for</span>
          <input
            type="text"
            maxLength={200}
            placeholder="Optional"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <ModalFooter onCancel={onClose}>
          <button type="submit" className="os-btn-primary" disabled={!valid || saving}>
            Book
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
