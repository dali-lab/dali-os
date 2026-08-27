// Signal ②: always-on pill linking a Drive item back to the process that owns it.
// Rendered inline on rows whose loader-derived `linkedProcess` is set.
// Atlassian-lozenge style: neutral/gray, compact, no icon.

import type { MouseEvent } from "react";
import { Tooltip } from "~/components/ui/floating";

type ProcessLinkPillProps = {
  label: string;
  href: string;
};

export function ProcessLinkPill({ label, href }: ProcessLinkPillProps) {
  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    // Full navigation (round-trip) — the process page may be a server-rendered route.
    window.location.href = href;
  }

  return (
    <Tooltip content={`Linked process: ${label}`}>
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="shrink-0 inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium leading-none text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        {label}
      </button>
    </Tooltip>
  );
}
