import type { ReactNode } from "react";

// One line under a domain row (its Challenge, its Rubric): a small label, what's
// set, then small actions, with an optional editor opening underneath. Every
// such line renders through this so they read and behave alike.
export function DomainSubRow({
  label,
  value,
  action,
  editor,
}: {
  label: string;
  /** What's set now. Use <SubRowEmpty> when nothing is. */
  value: ReactNode;
  action?: ReactNode;
  /** Shown under the line while the lead edits it. */
  editor?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="w-20 shrink-0 text-os-grey">{label}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-foreground">{value}</div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      {editor && <div className="sm:pl-[5.75rem]">{editor}</div>}
    </div>
  );
}

/** The value slot when nothing is set yet. */
export function SubRowEmpty({ children }: { children: ReactNode }) {
  return <span className="text-os-grey">{children}</span>;
}
