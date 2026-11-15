import { useRef, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

// The island, the one dali.os switcher: a recessed os-well track with a raised
// thumb on the open tab. Page nav (PageTabRow) and in-section switchers (calendar
// views, settings sections) wear the same dress. Tabs that are routes pass an
// href and render as real links; the rest are ARIA tabs with arrow-key nav.

export type SegmentedTab = {
  label: string;
  active?: boolean;
  onClick?: () => void;
  /** Makes the tab a real link, so cmd-click opens a new browser tab. */
  href?: string;
  icon?: LucideIcon;
  count?: number;
};

/** "sm" is the switcher at rail width — same island, one size down, for places
 *  that can't spare 44px of height (the calendar's left rail). "toolbar" sits
 *  between the two: md's text, trimmed to the h-9 of the search field and
 *  filter pills it shares a controls row with. */
export type SegmentedSize = "sm" | "toolbar" | "md";

function osSegmentedTrackClass(size: SegmentedSize) {
  return cn(
    "inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto no-scrollbar rounded-[10px] bg-os-well p-0.5",
    size === "md" && "shrink-0",
  );
}

function osSegmentedItemClass(active: boolean, size: SegmentedSize) {
  return cn(
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium transition-colors",
    size === "sm" && "px-3 py-1 text-xs",
    size === "toolbar" && "h-[30px] px-3.5 text-sm",
    size === "md" && "h-[30px] px-[14px] text-sm",
    active
      ? "bg-os-bg text-foreground shadow-[0_0_0_1px_var(--color-os-container),0_1px_3px_var(--color-os-shadow)]"
      : "text-os-grey hover:text-foreground",
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

export function SegmentedTabButtons({
  items,
  label = "Section",
  className,
  stretch = false,
  size = "md",
}: {
  items: SegmentedTab[];
  label?: string;
  className?: string;
  /** Fill the container, segments sharing the width equally. */
  stretch?: boolean;
  size?: SegmentedSize;
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const track = cn(osSegmentedTrackClass(size), stretch && "w-full", className);
  const itemClass = (item: SegmentedTab) =>
    cn(osSegmentedItemClass(!!item.active, size), stretch && "flex-1 justify-center");
  const content = (item: SegmentedTab) => (
    <SubtabLabel label={item.label} icon={item.icon} count={item.count} active={item.active} />
  );

  if (items.length > 0 && items.every((i) => i.href)) {
    return (
      <nav className={track} aria-label={label}>
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.href!}
            aria-current={item.active ? "page" : undefined}
            className={itemClass(item)}
          >
            {content(item)}
          </Link>
        ))}
      </nav>
    );
  }

  const activeIndex = items.findIndex((i) => i.active);
  const tabbable = activeIndex === -1 ? 0 : activeIndex;

  function onKeyDown(e: KeyboardEvent<HTMLElement>, index: number) {
    const last = items.length - 1;
    const next =
      e.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    items[next].onClick?.();
  }

  return (
    <div className={track} role="tablist" aria-label={label}>
      {items.map((item, i) => (
        <button
          key={item.label}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={item.active ?? false}
          tabIndex={i === tabbable ? 0 : -1}
          onClick={item.onClick}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={itemClass(item)}
        >
          {content(item)}
        </button>
      ))}
    </div>
  );
}
