import { Tooltip } from "~/components/ui/floating";

/** Small "New" pill in the design's accent, shown on recently-joined active members. */
export function NewBadge() {
  return (
    <Tooltip
      content="Joined the lab within the last 30 days."
      variant="rich"
    >
      <span className="inline-flex items-center rounded-full bg-os-accent/15 text-os-accent px-1.5 py-0.5 text-[10px] font-semibold flex-shrink-0">
        New
      </span>
    </Tooltip>
  );
}

/** Cake marker shown when today is the member's birthday. */
export function BirthdayBadge() {
  return (
    <Tooltip content="Today is this member's birthday!" variant="rich">
      <span role="img" aria-label="Birthday today" className="flex-shrink-0 text-sm leading-none">
        🎂
      </span>
    </Tooltip>
  );
}
