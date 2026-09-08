import { type ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * The signature dark-navy catalog band. Callers own the bleed: the member shell
 * passes `-mx-5 sm:-mx-10 lg:-mx-16` (matching the shell's gutters) so the band
 * stretches edge-to-edge; the portal surface passes an empty string because it
 * has no gutters. `contentClassName` re-aligns inner content to the page grid.
 */
export function EduBand({
  bleedClassName,
  contentClassName,
  children,
}: {
  bleedClassName: string;
  contentClassName: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("bg-grad-navy", bleedClassName)}>
      <div className={cn("py-10", contentClassName)}>{children}</div>
    </div>
  );
}
