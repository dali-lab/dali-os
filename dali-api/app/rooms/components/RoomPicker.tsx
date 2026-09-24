import { useEffect, useState } from "react";
import { Select } from "~/components/ui/floating";

export type RoomOption = { id: string; name: string };

/**
 * "Which DALI room" picker for the meeting composer. Renders nothing when the
 * `room-booking` flag is off (the caller passes `enabled`). `onChange` also
 * hands back the room's name so the caller can prefill Location.
 */
export function RoomPicker({
  enabled,
  value,
  onChange,
  className,
}: {
  enabled: boolean;
  value: string;
  onChange: (roomId: string, room: RoomOption | null) => void;
  className?: string;
}) {
  const [rooms, setRooms] = useState<RoomOption[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/rooms", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { rooms: [] }))
      .then((j: { rooms: RoomOption[] }) => {
        if (!cancelled) setRooms(j.rooms);
      })
      .catch(() => {
        if (!cancelled) setRooms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || !rooms || rooms.length === 0) return null;

  return (
    <Select
      ariaLabel="Room"
      value={value}
      onChange={(id) => onChange(id, rooms.find((r) => r.id === id) ?? null)}
      options={[{ value: "", label: "No room" }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]}
      buttonClassName={className}
    />
  );
}
