/** Small "New" pill — brand tint (coral), shown on recently-joined active members. */
export function NewBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-accent-coral/15 text-accent-coral px-1.5 py-0.5 text-[10px] font-semibold flex-shrink-0">
      New
    </span>
  );
}

/** Cake marker shown when today is the member's birthday. */
export function BirthdayBadge() {
  return (
    <span role="img" aria-label="Birthday today" className="flex-shrink-0 text-sm leading-none">
      🎂
    </span>
  );
}
