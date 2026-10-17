import type React from "react";
import { cn } from "~/lib/cn";
import { PANEL_CARD, PANEL_HEADER, PANEL_TITLE } from "~/hiring/components/ApplicantPanel";

// A titled block on the hiring detail routes (Reviews, Interviews) with a
// right-aligned header slot. Same card as ApplicantPanel, so an empty block
// reads like its neighbours.
export function DetailCard({
  title,
  subtitle,
  headerExtra,
  children,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={cn(PANEL_CARD, className)}>
      <div className={cn(PANEL_HEADER, "flex items-start justify-between gap-3 pb-5")}>
        <div className="min-w-0">
          <h2 className={PANEL_TITLE}>{title}</h2>
          {subtitle != null && <p className="mt-1 text-sm text-os-grey">{subtitle}</p>}
        </div>
        {headerExtra != null && <div className="flex-shrink-0">{headerExtra}</div>}
      </div>
      {children}
    </section>
  );
}
