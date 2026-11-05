import { useLayoutEffect, useRef } from "react";
import { cn } from "~/lib/cn";
import { isSwitching } from "./PanelFrame";
import type { Dialog } from "./types";

type Tab = "task" | "milestone" | "period";

const TABS: { value: Tab; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "milestone", label: "Milestone" },
  { value: "period", label: "Term or period" },
];

let previous: { tab: Tab; at: number } | null = null;

export function PanelTabs({
  active,
  openDialog,
}: {
  active: Tab;
  openDialog: (d: Dialog) => void;
}) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const thumb = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = thumb.current;
    const target = buttons.current[active];
    if (!el || !target) return;
    const place = (b: HTMLButtonElement) => {
      el.style.transform = `translateX(${b.offsetLeft}px)`;
      el.style.width = `${b.offsetWidth}px`;
    };
    const from = previous && previous.tab !== active && isSwitching(previous.at, Date.now()) ? buttons.current[previous.tab] : null;
    previous = null;
    if (from) {
      el.style.transition = "none";
      place(from);
      void el.offsetWidth;
      el.style.transition = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), width 260ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    }
    place(target);
    return () => {
      previous = { tab: active, at: Date.now() };
    };
  }, [active]);

  const go = (next: Tab) => {
    if (next === active) return;
    if (next === "task") openDialog({ kind: "task", taskId: null });
    else if (next === "milestone") openDialog({ kind: "milestone", milestoneId: null });
    else openDialog({ kind: "period", periodId: null });
  };

  return (
    <div role="radiogroup" aria-label="What to add" className="relative inline-flex rounded-full border border-border bg-muted/40 p-1">
      <span ref={thumb} aria-hidden className="absolute bottom-1 left-0 top-1 rounded-full bg-background shadow-sm" style={{ width: 0 }} />
      {TABS.map((t) => (
        <button
          key={t.value}
          ref={(b) => {
            buttons.current[t.value] = b;
          }}
          type="button"
          role="radio"
          aria-checked={active === t.value}
          onClick={() => go(t.value)}
          className={cn(
            "relative z-10 inline-flex h-7 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40",
            active === t.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
