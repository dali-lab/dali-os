import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

// The dali.os section switcher. The design navigates areas from the sidebar
// rail and has no underline tab bar; the few pages whose sections aren't sidebar
// destinations — calendar's three views, settings' sections — switch with a
// segmented pill: one track, the active segment filled, sized to its content.

export type UnderlineTabButton = {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  count?: number;
};

const osSegmentedTrackClass =
  "inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-full border border-border bg-os-card p-1";

function osSegmentedItemClass(active: boolean) {
  return cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-os-container text-foreground"
      : "text-muted-foreground hover:text-foreground",
  );
}

function SubtabLabel({
  label,
  icon: Icon,
  count,
  active,
}: {
  label: string;
  icon?: LucideIcon;
  count?: number;
  active?: boolean;
}) {
  return (
    <>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold",
            active ? "bg-os-accent text-os-bg" : "bg-os-card text-os-grey",
          )}
        >
          {count}
        </span>
      )}
    </>
  );
}

// The os switcher on its own, for pages that host it inside a controls row they
// already have (the Partners hub puts it beside its search field) rather than
// on a row of its own above the page title.
export function SegmentedTabButtons({
  items,
  label = "Section",
  className,
  stretch = false,
}: {
  items: UnderlineTabButton[];
  label?: string;
  className?: string;
  /** Fill the container, segments sharing the width equally. */
  stretch?: boolean;
}) {
  return (
    <div
      className={cn(osSegmentedTrackClass, stretch && "w-full", className)}
      role="tablist"
      aria-label={label}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="tab"
          aria-selected={item.active ?? false}
          onClick={item.onClick}
          className={cn(
            osSegmentedItemClass(!!item.active),
            stretch && "flex-1 justify-center",
          )}
        >
          <SubtabLabel
            label={item.label}
            icon={item.icon}
            count={item.count}
            active={item.active}
          />
        </button>
      ))}
    </div>
  );
}

export function UnderlineTabButtons({
  items,
  label = "Section",
  heading,
}: {
  items: UnderlineTabButton[];
  label?: string;
  /**
   * The page's own title, rendered at the left of this row — one line instead of
   * a title stacked above a rail of pills. The switcher is pushed to the far
   * right, so a row with no heading still ends on the same edge as one with it.
   */
  heading?: ReactNode;
}) {
  // No Guide button or history arrows here: the os top bar carries both.
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {heading}
      <SegmentedTabButtons items={items} label={label} className="ml-auto" />
    </div>
  );
}
