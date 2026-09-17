import { Fragment } from "react";
import { cn } from "~/lib/cn";

// The value's emphasis. Dynamic facts (seats left, a closing deadline) carry
// urgency the static ones don't, so a row can tint its value: `urgent` for the
// things a viewer should act on (nearly full, closing soon), `positive` for a
// healthy signal, `muted` for what's inactive (closed, not yet open).
export type MetaTone = "default" | "muted" | "urgent" | "positive";

const TONE_CLASS: Record<MetaTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  urgent: "font-semibold text-accent-coral",
  positive: "font-medium text-accent-teal",
};

export type MetaRow = { label: string; value: string; tone?: MetaTone };

// Facts as labelled rows rather than one dot-joined sentence. Dates, counts and
// deadlines are separate things people scan for, and running them together as
// prose makes each one slower to find — so a card or panel that has three of
// them lists them instead of writing them out.
//
// Shared rather than per-surface: the education catalog cards, the offering
// detail pane and the portal's action cards all present the same shape, and a
// look change should land on all of them at once.
export function MetaList({
  rows,
  className,
}: {
  rows: MetaRow[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs",
        className,
      )}
    >
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt className="font-medium text-muted-foreground">{r.label}</dt>
          <dd className={TONE_CLASS[r.tone ?? "default"]}>{r.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
