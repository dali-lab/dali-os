import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import {
  TablessHistoryNavInline,
  useShowTablessHistoryNav,
} from "~/components/TablessHistoryNav";

// The dali.os section switcher. The design navigates areas from the sidebar
// rail and has no underline tab bar; the few pages whose sections aren't sidebar
// destinations — calendar's three views, settings' sections — switch with a
// segmented pill: one track, the active segment filled, sized to its content.

export type UnderlineTabButton = {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon?: LucideIcon;
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
}: {
  label: string;
  icon?: LucideIcon;
}) {
  return (
    <>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {label}
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
}: {
  items: UnderlineTabButton[];
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(osSegmentedTrackClass, className)}
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
          className={osSegmentedItemClass(!!item.active)}
        >
          <SubtabLabel label={item.label} icon={item.icon} />
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
  const showHistoryNav = useShowTablessHistoryNav();
  // No Guide button here: the os top bar already carries it. The history arrows
  // stay — hasSubnavRow still counts this page as owning a row, so the shell's
  // standalone arrow bar stands down for it.
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {showHistoryNav && <TablessHistoryNavInline />}
      {heading}
      <SegmentedTabButtons items={items} label={label} className="ml-auto" />
    </div>
  );
}
