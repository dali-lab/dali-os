import { Fragment } from "react";
import { cn } from "~/lib/cn";

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
  rows: { label: string; value: string }[];
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
          <dd className="text-foreground">{r.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
