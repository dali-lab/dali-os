import { useEffect, useState } from "react";
import { MultiSelect } from "~/components/ui/floating";

export type RoomOption = { id: string; name: string };

/**
 * "Which DALI rooms" picker for the meeting composer: a big event can span
 * several. Renders nothing when the `room-booking` flag is off (the caller
 * passes `enabled`). `onChange` also hands back the chosen rooms so the caller
 * can prefill Location.
 */
export function RoomPicker({
  enabled,
  value,
  onChange,
  className,
}: {
  enabled: boolean;
  value: string[];
  onChange: (roomIds: string[], rooms: RoomOption[]) => void;
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
    <MultiSelect
      ariaLabel="Rooms"
      placeholder="No room"
      values={value}
      onChange={(ids) => onChange(ids, rooms.filter((r) => ids.includes(r.id)))}
      options={rooms.map((r) => ({ value: r.id, label: r.name }))}
      buttonClassName={className}
    />
  );
}
