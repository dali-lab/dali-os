/**
 * Shared date-grouped time-slot picker used by the scheduling page and portal views.
 * Renders inside a constrained scroll container with sticky date headers.
 */

interface Slot {
  id: string;
  date: string;
  time: string;
}

interface DateGroup {
  date: string;
  slots: Slot[];
}

interface InterviewSlotPickerProps {
  /** Slots grouped by date. */
  groups: DateGroup[];
  /** Currently selected slot id (selectable variant only). */
  selectedSlotId?: string | null;
  /** Called when a slot is clicked. */
  onSelect: (slot: Slot) => void;
  /** Visual / interaction variant. */
  variant: "schedule" | "selectable" | "reschedule";
  /** Per-slot loading id — shows "Booking..." on that button (schedule variant). */
  loadingSlotId?: string | null;
  /** Whether all buttons should be disabled (e.g. while a booking request is in-flight). */
  disabled?: boolean;
}

export function InterviewSlotPicker({
  groups,
  selectedSlotId,
  onSelect,
  variant,
  loadingSlotId,
  disabled,
}: InterviewSlotPickerProps) {
  if (groups.length === 0) return null;

  return (
    <div className="max-h-[50vh] sm:max-h-[60vh] overflow-y-auto">
      <div className="space-y-6">
        {groups.map(({ date, slots }) => (
          <div key={date}>
            <h4
              className={`text-sm font-bold mb-2 sticky top-0 z-10 py-1 ${
                variant === "schedule"
                  ? "text-foreground/80 uppercase tracking-wider mb-3 bg-background"
                  : "text-dark-blue bg-white"
              }`}
            >
              {date}
            </h4>
            <div
              className={
                variant === "schedule"
                  ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
                  : "grid grid-cols-1 sm:grid-cols-2 gap-2"
              }
            >
              {slots.map((slot) => {
                const isLoading = loadingSlotId === slot.id;
                const isSelected = selectedSlotId === slot.id;

                if (variant === "schedule") {
                  return (
                    <button
                      key={slot.id}
                      onClick={() => onSelect(slot)}
                      disabled={disabled}
                      className="px-3 py-3 text-sm font-medium rounded-lg border border-border bg-card hover:border-blue-400 hover:bg-blue-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? "Booking..." : slot.time}
                    </button>
                  );
                }

                if (variant === "selectable") {
                  return (
                    <button
                      key={slot.id}
                      onClick={() => onSelect(slot)}
                      className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all text-left ${
                        isSelected
                          ? "border-accent-coral bg-accent-coral/5 text-accent-coral"
                          : "border-border text-dark-blue hover:border-accent-coral/50"
                      }`}
                    >
                      {slot.time}
                    </button>
                  );
                }

                // reschedule
                return (
                  <button
                    key={slot.id}
                    onClick={() => onSelect(slot)}
                    className="px-4 py-3 rounded-xl text-sm font-medium border-2 border-border text-dark-blue hover:border-accent-coral/50 transition-all text-left"
                  >
                    {slot.time}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { Slot, DateGroup, InterviewSlotPickerProps };
