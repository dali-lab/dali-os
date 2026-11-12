import { AnchoredCard } from "~/components/ui/floating/AnchoredCard";
import { WorkingHoursCard } from "~/calendar/components/settings-cards";
import type { LoaderData } from "~/calendar/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────


export function WorkingHoursPopover({
  data,
  anchor,
  onClose,
}: {
  data: LoaderData;
  anchor: DOMRect;
  onClose: () => void;
}) {
  return (
    <AnchoredCard
      anchor={anchor}
      onClose={onClose}
      ariaLabel="Working hours"
      className="w-[25rem] max-h-[80vh] overflow-y-auto rounded-xl cal-surface p-4"
    >
      <WorkingHoursCard workingHours={data.workingHours} hasPersisted={data.hasPersistedWorkingHours} />
    </AnchoredCard>
  );
}

// ── EventComposer ──────────────────────────────────────────────────────────
// Create / edit / delete a Google Calendar event. Recurrence-create is deferred
// (single events for now); editing patches this event/occurrence's fields.
