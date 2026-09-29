// General ▸ Rooms. Pick a DALI room and a day, see its bookings and meetings on
// a day timeline, and book a free slot. The schedule is fetched client-side
// for the browser's local day (the same /api/rooms/:id/schedule window the
// iPad door display uses), so the server's timezone never matters. Behind the
// `room-booking` flag.

import { useCallback, useEffect, useMemo, useState } from "react";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Route } from "./+types/rooms";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isRoomBookingEnabled } from "~/rooms/lib/access.server";
import { useOsChrome } from "~/components/os-chrome";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Select } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { TimeField } from "~/components/ui/TimeField";
import { IconButton } from "~/components/ui/IconButton";
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
  if (!(await isRoomBookingEnabled(auth.user.sub, request))) throw redirect("/");

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

  const roomId = params.get("room") ?? rooms[0]?.id ?? "";
  const dateKey = params.get("date") ?? todayKey();
  const room = rooms.find((r) => r.id === roomId) ?? null;

  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    if (!roomId) return;
    const { start, end } = localDay(dateKey);
    const qs = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const res = await fetch(`/api/rooms/${roomId}/schedule?${qs}`, { credentials: "include" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Couldn't load the room's schedule.");
      setItems([]);
      return;
    }
    setItems(json.items);
  }, [roomId, dateKey, toast]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const openDraftAt = (start: Date) => {
    const end = new Date(start.getTime() + 60 * 60_000);
    setDraft({ start: hhmm(start), end: hhmm(end) });
  };

  const openDraftNext = () => {
    const now = new Date();
    const base = dateKey === todayKey() ? now : atTime(dateKey, `${pad(9)}:00`);
    const snapped = new Date(base);
    snapped.setSeconds(0, 0);
    snapped.setMinutes(Math.ceil(snapped.getMinutes() / SNAP_MIN) * SNAP_MIN);
    openDraftAt(snapped);
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
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className={chrome.pageTitle}>Rooms</h1>
        <p className={chrome.bodyText}>No rooms can be booked yet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-2">
        <h1 className={chrome.pageTitle}>Rooms</h1>
        {room && (
          <p className={chrome.bodyText}>
            {[room.description, room.capacity ? `Seats ${room.capacity}` : null].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Select
            ariaLabel="Room"
            value={roomId}
            onChange={(id) => setParam("room", id)}
            options={rooms.map((r) => ({ value: r.id, label: r.name }))}
            buttonClassName={chrome.formTrigger}
          />
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Previous day" icon={ChevronLeft} onClick={() => setParam("date", shiftDay(dateKey, -1))} />
          <div className="w-44">
            <DateField
              mode="date"
              ariaLabel="Day"
              value={dateKey}
              onChange={(v) => v && setParam("date", v)}
              buttonClassName={chrome.formTrigger}
            />
          </div>
          <IconButton label="Next day" icon={ChevronRight} onClick={() => setParam("date", shiftDay(dateKey, 1))} />
        </div>
        {dateKey !== todayKey() && (
          <button type="button" className="os-btn-ghost" onClick={() => setParam("date", todayKey())}>
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
          items={items}
          userId={userId}
          onPickSlot={openDraftAt}
          onCancel={cancelBooking}
        />
      </section>

      {room && (
        <BookingModal
          open={draft !== null}
          roomId={room.id}
          roomName={room.name}
          dateKey={dateKey}
          initial={draft}
          onClose={() => setDraft(null)}
          onBooked={() => {
            setDraft(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DayTimeline({
  dateKey,
  items,
  userId,
  onPickSlot,
  onCancel,
}: {
  dateKey: string;
  items: ScheduleItem[] | null;
  userId: string;
  onPickSlot: (start: Date) => void;
  onCancel: (item: ScheduleItem) => void;
}) {
  const chrome = useOsChrome();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const dayStart = atTime(dateKey, `${pad(DAY_START_HOUR)}:00`).getTime();
  const dayEnd = atTime(dateKey, `${pad(DAY_END_HOUR)}:00`).getTime();
  const heightPx = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
  const yFor = (t: number) =>
    ((Math.min(Math.max(t, dayStart), dayEnd) - dayStart) / 3_600_000) * HOUR_PX;

  const hours = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    [],
  );

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / HOUR_PX) * 60;
    const snapped = Math.floor(minutes / SNAP_MIN) * SNAP_MIN;
    const start = new Date(dayStart + snapped * 60_000);
    if (start.getTime() + SNAP_MIN * 60_000 < now) return;
    onPickSlot(start);
  };

  return (
    <div className="relative flex" style={{ height: heightPx }}>
      <div className="relative w-16 shrink-0">
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
      <div
        role="presentation"
        className="relative flex-1 cursor-pointer border-l border-os-container"
        onClick={pick}
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
          return (
            <div
              key={`${item.kind}-${item.id}-${item.start}`}
              className={cn(
                "absolute inset-x-2 overflow-hidden rounded-[10px] border px-3 py-1.5 text-sm",
                item.kind === "meeting"
                  ? "border-os-accent/40 bg-os-accent/15 text-foreground"
                  : "border-os-container bg-os-well text-foreground",
              )}
              style={{ top, height }}
            >
              <div className="flex items-start justify-between gap-2">
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
                  <IconButton label="Cancel booking" icon={X} onClick={() => onCancel(item)} />
                )}
              </div>
            </div>
          );
        })}

        {dateKey === todayKey() && now > dayStart && now < dayEnd && (
          <div
            className="pointer-events-none absolute inset-x-0 h-0.5 bg-[var(--os-danger-ink)]"
            style={{ top: yFor(now) }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

function BookingModal({
  open,
  roomId,
  roomName,
  dateKey,
  initial,
  onClose,
  onBooked,
}: {
  open: boolean;
  roomId: string;
  roomName: string;
  dateKey: string;
  initial: { start: string; end: string } | null;
  onClose: () => void;
  onBooked: () => void;
}) {
  const chrome = useOsChrome();
  const toast = useToast();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial) return;
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
      toast.success(`Booked ${roomName}.`);
      onBooked();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="book-room-title">
      <ModalHeader
        titleId="book-room-title"
        title={`Book ${roomName}`}
        subtitle={localDay(dateKey).start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        onClose={onClose}
      />
      <form onSubmit={submit} className={cn(chrome.formClass, "flex flex-col gap-5")}>
        <div className="os-field-row">
          <div className="os-field-group">
            <span className="os-field-label">Starts</span>
            <TimeField value={start} onChange={setStart} ariaLabel="Starts" />
          </div>
          <div className="os-field-group">
            <span className="os-field-label">Ends</span>
            <TimeField value={end} onChange={setEnd} ariaLabel="Ends" />
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
