// Building blocks for the application record's property rail and the panels
// mounted inside it, so every group reads with the same hierarchy: a group
// title, then small grey captions over full-size values.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/cn";
import type { PillTone } from "~/hiring/components/cycle-setup/SetupCard";
import type { PartnerStage } from "../../lib/partner-application";

export const RAIL_CONTROL =
  "w-full rounded-xl bg-os-card px-3 py-2 text-sm text-foreground inline-flex items-center justify-between gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40 disabled:opacity-60";

export const RAIL_LINK = "text-os-accent hover:underline";

export const STAGE_TONE: Record<PartnerStage, PillTone> = {
  Backlog: "neutral",
  New: "warning",
  Interview: "accent",
  Deciding: "accent",
  Accepted: "success",
  Rejected: "danger",
};

export function RailGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section
      id={`details-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      data-detail-section={title}
      className="flex scroll-mt-4 flex-col gap-3 py-6 first:pt-0 last:pb-0"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-[15px] font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The Details tab's frame: every RailGroup stacked in one column, with a nav of
 * their titles beside it that scrolls to a section and marks the one in view.
 * The nav reads the sections from the DOM, so callers only render RailGroups.
 */
export function DetailsLayout({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll<HTMLElement>(":scope > [data-detail-section]"));
    setSections(nodes.map((n) => ({ id: n.id, title: n.dataset.detailSection ?? "" })));
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [children]);

  return (
    <div className="os-form grid grid-cols-1 gap-8 md:grid-cols-[10rem_minmax(0,1fr)]">
      <nav aria-label="Details sections" className="hidden self-start md:sticky md:top-0 md:block">
        <ul className="flex flex-col gap-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={active === s.id ? "true" : undefined}
                onClick={() => {
                  document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  setActive(s.id);
                }}
                className={cn(
                  "w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                  active === s.id
                    ? "bg-os-container font-medium text-foreground"
                    : "text-os-grey hover:bg-os-hover hover:text-foreground",
                )}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div ref={contentRef} className="flex min-w-0 max-w-3xl flex-col divide-y divide-os-container">
        {children}
      </div>
    </div>
  );
}

export function RailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-os-grey">{label}</span>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}

/** A read-only fact on one line, caption left and value right. */
export function RailFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-os-grey">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{children}</span>
    </div>
  );
}
