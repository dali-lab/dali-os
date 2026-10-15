import type { ReactNode } from "react";

/** One labelled fact in a details panel. Renders nothing when the value is
 *  empty, so a doc with no size doesn't show a blank row. */
export function DetailFact({ label, value }: { label: string; value: ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-bold uppercase tracking-[0.5px] text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground break-words">{value}</dd>
    </div>
  );
}
