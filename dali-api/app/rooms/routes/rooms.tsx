// General ▸ Rooms. Pick a day, see every DALI room's bookings and meetings side
// by side on one day timeline, and book a free slot or open what's there. The
// schedule is fetched client-side for the browser's local day (the same
// /api/rooms/:id/schedule window the iPad door display uses), so the server's
// timezone never matters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import type { Route } from "./+types/rooms";
import { prisma } from "~/lib/db.server";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { redirectToLogin } from "~/lib/login-next";
import { useOsChrome } from "~/components/os-chrome";
import { DateField } from "~/components/ui/DateField";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { BookingDetailPopover, bookingWhen } from "~/rooms/components/BookingDetailPopover";
import { BookingModal, type BookingDraft } from "~/rooms/components/BookingModal";
import { requestCancel, withoutCancelled, type CancelScope } from "~/rooms/lib/optimistic-cancel";
import {
  atTime,
  bookingAccess,
  dayKey,
  DAY_END_HOUR,
  DAY_START_HOUR,
  hhmm,
  localDay,
  nextBookableSlot,
  notInPast,
  overlapLanes,
  shiftDay,
  slotForClick,
  SNAP_MIN,
  timeLabel,
  type ScheduleItem,
} from "~/rooms/lib/timeline";

export const meta: Route.MetaFunction = () => [{ title: "Rooms · DALI OS" }];

export const handle = {
  breadcrumb: () => "Rooms",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");

  const [rooms, core] = await Promise.all([
    prisma.room.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, description: true, capacity: true },
      orderBy: { name: "asc" },
    }),
    isCore(auth.user.sub),
  ]);
  return { rooms, userId: auth.user.sub, core };
}

const HOUR_PX = 56;
// A drag snaps finer than a click, like the iPad timeline.
const DRAG_SNAP_MIN = 15;
// Less movement than this is a click, not a drag.
const DRAG_THRESHOLD_MIN = 10;
// A card this short has no room for its time and organizer.
const SHORT_CARD_PX = 36;

// A room's column and its header share this so they line up; the floor keeps a
// booking's title readable when many rooms sit side by side.
const ROOM_COLUMN = "min-w-[11rem] flex-1 basis-0";

type RoomInfo = { id: string; name: string; description: string | null; capacity: number | null };
type Detail = { item: ScheduleItem; roomId: string; anchor: DOMRect };

const itemKey = (item: ScheduleItem) => `${item.kind}-${item.id}-${item.start}`;
const organizerName = (item: ScheduleItem) => `${item.organizer.firstName} ${item.organizer.lastName}`;

export default function RoomsPage() {
  const { rooms, userId, core } = useLoaderData<typeof loader>();
  const chrome = useOsChrome();
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();

  const todayKey = dayKey(new Date());
  const dateKey = params.get("date") ?? todayKey;

  const [itemsByRoom, setItemsByRoom] = useState<Record<string, ScheduleItem[]> | null>(null);
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

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
    setDetail(null);
    void load();
  }, [load]);

  const openDraftAt = (roomId: string, start: Date, end: Date) => {
    setDraft({ date: dateKey, roomId, start: hhmm(start), end: hhmm(end) });
  };

  const openDraftNext = () => {
    const slot = nextBookableSlot(dateKey, new Date());
    setDraft({ date: slot.date, roomId: rooms[0]!.id, start: hhmm(slot.start), end: hhmm(slot.end) });
  };

  const editBooking = async ({ item, roomId }: Detail) => {
    setDetail(null);
    let scope: "this" | "all" | null = null;
    if (item.recurring) {
      const picked = await dialog.choice({
        title: "Edit repeating booking",
        options: [
          { value: "this", label: "This time only", description: "Change when this one happens." },
          { value: "all", label: "Whole series", description: "Change the room, name or time of every date." },
        ],
        cancelLabel: "Keep it",
      });
      if (!picked) return;
      scope = picked as "this" | "all";
    }
    const start = new Date(item.start);
    setDraft({
      date: dayKey(start),
      roomId,
      start: hhmm(start),
      end: hhmm(new Date(item.end)),
      edit: { item, scope },
    });
  };

  const cancelBooking = async (item: ScheduleItem) => {
    setDetail(null);
    const underway = new Date(item.start) <= new Date();

    const hide = (scope: CancelScope) => {
      const now = new Date();
      setItemsByRoom((prev) =>
        prev &&
        Object.fromEntries(Object.entries(prev).map(([roomId, list]) => [roomId, withoutCancelled(list, item, scope, now)])),
      );
    };
    const restore = (error: string) => {
      toast.error(error);
      void load();
    };

    if (item.recurring) {
      const scope = await dialog.choice({
        title: "Cancel repeating booking",
        options: [
          { value: "this", label: "This time only", description: "The rest of the series stays." },
          { value: "following", label: "This and following", description: "Earlier times stay." },
          { value: "all", label: "Whole series" },
        ],
        cancelLabel: "Keep it",
      });
      if (!scope) return;
      hide(scope as CancelScope);
      const outcome = await requestCancel(item.id, { scope: scope as CancelScope, occurrenceStart: item.occurrenceStart });
      if (!outcome.ok) {
        restore(outcome.error);
        return;
      }
      if (scope === "this") toast.success(underway ? "Booking ended." : "Booking cancelled.");
      else if (scope === "following") toast.success("Series cancelled from here.");
      else toast.success("Series cancelled.");
      void load();
      return;
    }

    const ok = await dialog.confirm({
      title: underway ? "End this booking now?" : "Cancel this booking?",
      description: underway ? "The rest of the slot frees up for others." : undefined,
      confirmLabel: underway ? "End now" : "Cancel booking",
      cancelLabel: "Keep it",
      tone: "destructive",
    });
    if (!ok) return;
    hide("this");
    const outcome = await requestCancel(item.id);
    if (!outcome.ok) {
      restore(outcome.error);
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
          {dateKey !== todayKey && (
            <button type="button" className="os-btn-ghost" onClick={() => setDate(todayKey)}>
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
            selectedKey={detail ? itemKey(detail.item) : null}
            onPickSlot={openDraftAt}
            onOpen={(item, roomId, anchor) => setDetail({ item, roomId, anchor })}
          />
        </section>
      </div>

      {detail && (
        <BookingDetailPopover
          item={detail.item}
          roomName={rooms.find((r) => r.id === detail.roomId)?.name ?? ""}
          anchor={detail.anchor}
          access={bookingAccess(detail.item, { userId, core }, new Date())}
          onClose={() => setDetail(null)}
          onEdit={() => void editBooking(detail)}
          onCancel={() => void cancelBooking(detail.item)}
        />
      )}

      <BookingModal
        rooms={rooms}
        initial={draft}
        onClose={() => setDraft(null)}
        onSaved={(date) => {
          setDraft(null);
          if (date === dateKey) void load();
          else setDate(date);
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
  selectedKey,
  onPickSlot,
  onOpen,
}: {
  dateKey: string;
  rooms: RoomInfo[];
  itemsByRoom: Record<string, ScheduleItem[]> | null;
  selectedKey: string | null;
  onPickSlot: (roomId: string, start: Date, end: Date) => void;
  onOpen: (item: ScheduleItem, roomId: string, anchor: DOMRect) => void;
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
              selectedKey={selectedKey}
              mountedNow={mountedNow}
              onPickSlot={(start, end) => onPickSlot(r.id, start, end)}
              onOpen={(item, anchor) => onOpen(item, r.id, anchor)}
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
  selectedKey,
  mountedNow,
  onPickSlot,
  onOpen,
}: {
  dateKey: string;
  hours: number[];
  items: ScheduleItem[] | null;
  selectedKey: string | null;
  mountedNow: number | null;
  onPickSlot: (start: Date, end: Date) => void;
  onOpen: (item: ScheduleItem, anchor: DOMRect) => void;
}) {
  const chrome = useOsChrome();
  const now = mountedNow ?? Date.now();

  const dayStart = atTime(dateKey, `${DAY_START_HOUR}:00`).getTime();
  const dayEnd = atTime(dateKey, `${DAY_END_HOUR}:00`).getTime();
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
    const clock = new Date();
    if (dragging) {
      const start = notInPast(at(dragRange.from), clock);
      if (start >= at(dragRange.to)) return;
      onPickSlot(start, at(dragRange.to));
      return;
    }
    const slot = at(Math.floor(drag.from / SNAP_MIN) * SNAP_MIN);
    if (slot.getTime() + SNAP_MIN * 60_000 < clock.getTime()) return;
    const { start, end } = slotForClick(slot, items ?? [], clock);
    onPickSlot(start, end);
  };

  const lanes = overlapLanes(items ?? []);

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

      {items?.map((item, index) => {
        const start = new Date(item.start).getTime();
        const end = new Date(item.end).getTime();
        if (end <= dayStart || start >= dayEnd) return null;
        const top = yFor(start);
        const height = Math.max(yFor(end) - top, 22);
        const short = height <= SHORT_CARD_PX;
        const when = `${timeLabel(item.start)} to ${timeLabel(item.end)}`;
        const { lane, lanes: laneCount } = lanes[index]!;
        const selected = selectedKey === itemKey(item);
        return (
          <Tooltip
            key={itemKey(item)}
            variant="rich"
            placement="right"
            content={
              short && !selected ? (
                <>
                  <span className="block font-medium">{item.title}</span>
                  {bookingWhen(item)}
                  <span className="block text-os-grey">{organizerName(item)}</span>
                </>
              ) : null
            }
          >
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`${item.title}, ${when}, ${organizerName(item)}`}
              onClick={(e) => onOpen(item, e.currentTarget.getBoundingClientRect())}
              className={cn(
                "absolute flex cursor-pointer flex-col overflow-hidden rounded-[10px] border px-3 text-left text-sm text-foreground transition-colors hover:z-[5] focus:outline-none focus-visible:z-[5] focus-visible:ring-2 focus-visible:ring-os-accent",
                short ? "justify-center py-0.5" : "justify-start py-1.5",
                item.kind === "meeting"
                  ? "bg-os-accent/15 hover:bg-os-accent/25"
                  : "bg-os-well hover:bg-os-container",
                selected && "z-[5] ring-2 ring-os-accent",
                item.kind === "meeting"
                  ? "border-os-accent/40 hover:border-os-accent"
                  : "border-os-container hover:border-os-container-hi",
              )}
              style={{
                top,
                height,
                left: `calc(0.5rem + ${lane} * (100% - 1rem) / ${laneCount})`,
                width: `calc((100% - 1rem) / ${laneCount} - ${laneCount > 1 ? 2 : 0}px)`,
              }}
            >
              <span className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 truncate font-medium">{item.title}</span>
                {item.recurring && <Repeat className="h-3 w-3 shrink-0 text-os-grey" aria-label="Repeats" />}
              </span>
              {!short && (
                <span className="block truncate text-xs text-os-grey">
                  {when} · {organizerName(item)}
                </span>
              )}
            </button>
          </Tooltip>
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

      {mountedNow !== null && dateKey === dayKey(new Date()) && now > dayStart && now < dayEnd && (
        <div
          className="pointer-events-none absolute inset-x-0 h-0.5 bg-[var(--os-danger-ink)]"
          style={{ top: yFor(now) }}
          aria-hidden
        />
      )}
    </div>
);
}
