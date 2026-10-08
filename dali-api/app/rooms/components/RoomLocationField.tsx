import { useEffect, useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  FloatingPortal,
} from "@floating-ui/react";
import { Check } from "lucide-react";
import { cn } from "~/lib/cn";
import { usePanelClass } from "~/components/ui/floating/os-styles";

type Room = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  // What already holds the room in the asked-for window (absent without one).
  conflict?: string | null;
  // The colliding occurrence's date, when `conflict` came from a series check
  // and it wasn't the first occurrence (absent otherwise).
  conflictOn?: string | null;
};

/** The Location text a set of rooms writes, and the text that keeps them held. */
export function roomsLocation(rooms: { name: string }[]) {
  return rooms.map((r) => r.name).join(", ");
}

/**
 * The composer's Location field. It stays a free-text input that also suggests
 * the DALI rooms (when `enabled`: the event's shape can hold one), marked
 * unavailable when something already holds them in the event's window.
 *
 * Picking a room writes its name as the location and reports it through
 * `onRoomsChange`, which is what the caller submits to hold the room. The hold
 * lasts only while the text is still the picked rooms' names: typing any other
 * location drops it, so what the field reads is always what gets booked.
 *
 * With `recurrenceRule` set, availability covers every occurrence of the
 * series, not just the one at `startIso`/`endIso`.
 */
export function RoomLocationField({
  enabled,
  id,
  name,
  value,
  onChange,
  roomIds,
  onRoomsChange,
  startIso,
  endIso,
  recurrenceRule,
  excludeMeetingId,
  placeholder,
  className,
}: {
  enabled: boolean;
  id: string;
  name?: string;
  value: string;
  onChange: (location: string) => void;
  roomIds: string[];
  onRoomsChange: (roomIds: string[]) => void;
  /** The event's window; availability is only known once both are set. */
  startIso?: string;
  endIso?: string;
  /** The event's repeat rule, when it has one — checks the whole series. */
  recurrenceRule?: string | null;
  /** The meeting being edited, so its own hold doesn't read as a conflict. */
  excludeMeetingId?: string;
  placeholder?: string;
  className?: string;
}) {
  const panelClass = usePanelClass();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (startIso && endIso && startIso < endIso) {
      params.set("start", startIso);
      params.set("end", endIso);
      if (recurrenceRule) params.set("recurrenceRule", recurrenceRule);
      if (excludeMeetingId) params.set("excludeMeetingId", excludeMeetingId);
    }
    fetch(`/api/rooms?${params}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { rooms: [] }))
      .then((j: { rooms: Room[] }) => {
        if (!cancelled) setRooms(j.rooms);
      })
      .catch(() => {
        if (!cancelled) setRooms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, startIso, endIso, recurrenceRule, excludeMeetingId]);

  const selected = rooms.filter((r) => roomIds.includes(r.id));
  const selectedText = roomsLocation(selected);
  // Typing narrows the list; the picked rooms' own names are not a search.
  const query = value.trim().toLowerCase();
  const options =
    !enabled || query === "" || value.trim() === selectedText
      ? rooms
      : rooms.filter((r) => r.name.toLowerCase().includes(query));
  const showList = enabled && open && options.length > 0;

  const { refs, floatingStyles, context } = useFloating({
    open: showList,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
            maxHeight: `${Math.min(availableHeight, 320)}px`,
          });
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useDismiss(context),
    useRole(context, { role: "listbox" }),
    useListNavigation(context, {
      listRef,
      activeIndex,
      onNavigate: setActiveIndex,
      // The highlight moves without stealing focus from the input.
      virtual: true,
      loop: true,
    }),
  ]);

  function toggle(room: Room) {
    const picked = roomIds.includes(room.id);
    if (!picked && room.conflict) return;
    const next = rooms.filter((r) => (r.id === room.id ? !picked : roomIds.includes(r.id)));
    onRoomsChange(next.map((r) => r.id));
    onChange(roomsLocation(next));
  }

  const listId = `${id}-rooms`;
  const unavailable = selected.filter((r) => r.conflict);
  const unavailableOn = unavailable.find((r) => r.conflictOn)?.conflictOn;

  return (
    <div>
      <input
        ref={refs.setReference}
        id={id}
        name={name}
        type="text"
        placeholder={placeholder}
        value={value}
        className={className}
        autoComplete="off"
        role={enabled ? "combobox" : undefined}
        aria-expanded={enabled ? showList : undefined}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete={enabled ? "list" : undefined}
        aria-activedescendant={
          showList && activeIndex !== null ? `${listId}-${activeIndex}` : undefined
        }
        {...getReferenceProps({
          onFocus: () => setOpen(true),
          onClick: () => setOpen(true),
          onChange: (e) => {
            const text = (e.target as HTMLInputElement).value;
            onChange(text);
            if (roomIds.length && text.trim() !== selectedText) onRoomsChange([]);
            setOpen(true);
            setActiveIndex(null);
          },
          onKeyDown: (e) => {
            const pick = showList && activeIndex !== null ? options[activeIndex] : undefined;
            if (e.key === "Enter" && pick) {
              e.preventDefault();
              toggle(pick);
            }
          },
          onBlur: () => {
            setOpen(false);
            setActiveIndex(null);
          },
        })}
      />
      {selected.length > 0 && (
        <p className={cn("mt-1 px-2.5 text-xs", unavailable.length ? "text-red-600" : "text-muted-foreground")}>
          {unavailable.length
            ? unavailableOn
              ? `${roomsLocation(unavailable)} is not available on ${unavailableOn}.`
              : `${roomsLocation(unavailable)} is not available at this time.`
            : `Books ${selectedText} for this time.`}
        </p>
      )}
      {showList && (
        <FloatingPortal>
          <ul
            ref={refs.setFloating}
            id={listId}
            aria-label="Rooms"
            aria-multiselectable
            style={floatingStyles}
            className={panelClass}
            {...getFloatingProps()}
          >
            {options.map((room, i) => {
              const picked = roomIds.includes(room.id);
              const blocked = !!room.conflict && !picked;
              const detail = room.conflict
                ? room.conflictOn
                  ? `Unavailable on ${room.conflictOn}, booked for ${room.conflict}`
                  : `Unavailable, booked for ${room.conflict}`
                : [room.description, room.capacity ? `Seats ${room.capacity}` : null]
                    .filter(Boolean)
                    .join(" · ");
              return (
                <li key={room.id} role="none">
                  <button
                    type="button"
                    role="option"
                    id={`${listId}-${i}`}
                    aria-selected={picked}
                    aria-disabled={blocked}
                    tabIndex={-1}
                    ref={(node) => {
                      listRef.current[i] = node;
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      blocked ? "cursor-not-allowed opacity-50" : "hover:bg-os-container",
                      i === activeIndex && "bg-os-container",
                    )}
                    {...getItemProps({
                      // The input's blur would otherwise close the list before
                      // the click could land on the row.
                      onMouseDown: (e) => e.preventDefault(),
                      onClick: () => toggle(room),
                    })}
                  >
                    <Check
                      className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", picked ? "text-os-accent" : "opacity-0")}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium text-foreground">{room.name}</span>
                      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </FloatingPortal>
      )}
    </div>
  );
}
