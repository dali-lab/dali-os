import type { ReactNode } from "react";
import { Link, useMatches } from "react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { PageDocButton } from "~/components/page-docs/PageDocButton";
import { useFeatureFlag } from "~/components/FeatureFlags";
import {
  TablessHistoryNavInline,
  useShowTablessHistoryNav,
} from "~/components/TablessHistoryNav";

// Horizontal sub-navigation between an area's sibling surfaces. Used where a
// sidebar area collapsed to a single entry: the area's landing page carries
// its role-gated sub-surfaces here instead of as sidebar children. Callers
// pass only the tabs the viewer may access.

export type AreaPill = {
  label: string;
  to: string;
  active?: boolean;
  icon?: LucideIcon;
};

export type UnderlineTabButton = {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon?: LucideIcon;
};

// The bar is two parts: a scrolling tab list and a fixed action cluster. They
// have to be separate elements — an action pinned with ml-auto *inside* the
// scroller counts toward its scroll width, so the row reported ~75px of
// overflow and scrolled on every page even when the tabs fitted easily.
const underlineTabBarClass = cn(
  "flex items-stretch border-b border-border mb-6 sm:mb-8",
  // Bleed to the iframe edges; tab items carry their own px-3 (matches workspace tabs).
  "-mx-3 sm:-mx-6 lg:-mx-10",
);

// nowrap so a long row stays on one line rather than wrapping under empty page
// space. It can still scroll when the viewport is genuinely narrower than the
// tab set, but the scrollbar itself is hidden — a visible track sitting under
// the tabs reads as chrome, not as an affordance.
// -mb-px sits here rather than on each tab: overflow-x:auto forces overflow-y
// to auto too, so a negative margin on a child became 1px of vertical scroll
// inside the list. On the list itself it still laps the bar's bottom border.
const underlineTabListClass =
  "flex min-w-0 flex-1 items-stretch gap-0.5 flex-nowrap overflow-x-auto no-scrollbar -mb-px";

// Actions never scroll with the tabs and keep the row's right edge.
const tabBarActionsClass = "flex shrink-0 items-center gap-2 self-center pl-2 pr-2";

// Leading slot for the desktop tabless history arrows. No left padding: the
// bar already bleeds to the window edge (-mx-3 sm:-mx-6 lg:-mx-10), and the
// standalone arrow bar (TablessHistoryNav) sits flush there — re-adding the
// content inset here left the arrows indented on subnav pages like calendar
// and nowhere else.
const tabBarLeadingClass = "flex shrink-0 items-center self-stretch";

// A 2px coral rule on a white page was doing all the work of saying "this tab
// is selected", and losing — at that weight the tint reads as a hairline rather
// than a state. The active tab now carries a 3px rule, a tinted body and
// rounded top corners so it reads as a tab sitting on the content below it,
// with the underline as reinforcement instead of the only signal.
/* The dali.os switcher. The design navigates from the sidebar rail and has no
   underline tab bar anywhere, so the pages whose sections aren't sidebar
   destinations — calendar's three views, settings' sections — switch with a
   segmented pill instead: one track, the active segment filled, sized to its
   content and sitting inline above the page rather than bleeding to the window
   edges under a rule. Same vocabulary as the People directory's Active/Alumni
   switch, so the flagged app has exactly one way to show "these are views of
   one page". */
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

function underlineTabItemClass(active: boolean) {
  return cn(
    // px-3, not more: the row is nowrap, so every extra pixel per tab pushes a
    // full tab set into a horizontal scrollbar.
    "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold font-heading",
    "rounded-t-md border-b-[3px] transition-colors shrink-0",
    active
      ? "border-accent-coral bg-accent-coral/10 text-accent-coral"
      : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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

export function AreaPillNav({
  items,
  className,
}: {
  items: AreaPill[];
  className?: string;
}) {
  // Only reserve room + host the Docs button when this page actually declares a
  // guide — otherwise the pill row stays exactly as it was. (Hook must run
  // before the early return below.)
  const matches = useMatches();
  const hasDoc = matches.some(
    (m) => (m as { handle?: { docKey?: string } }).handle?.docKey,
  );
  const showHistoryNav = useShowTablessHistoryNav();

  // Under the new left-nav, an area's sub-surfaces live in the sidebar dropdown,
  // so the in-page pill row is suppressed for flagged users. Off (default) it
  // renders exactly as today. Hook runs before the early return below.
  // The dali.os shell carries the same sidebar sub-tabs under its own flag, so
  // it suppresses the row for the same reason — otherwise a user on os without
  // the left-nav flag gets both copies of the same navigation.
  const redesign = useFeatureFlag("sidebar-redesign");
  const osRedesign = useFeatureFlag("os-redesign");
  if (redesign || osRedesign) return null;

  // A lone tab is pure noise — the page is already the only destination.
  // Still render the row if the history arrows need somewhere to live,
  // otherwise the desktop tabless nav has no row on pages whose pills
  // collapse to one (see educationPills etc.).
  if (items.length <= 1 && !showHistoryNav) return null;

  return (
    <nav className={cn(underlineTabBarClass, className)} aria-label="Section">
      {showHistoryNav && (
        <span className={tabBarLeadingClass}>
          <TablessHistoryNavInline />
        </span>
      )}
      <span className={underlineTabListClass}>
        {items.length > 1 &&
          items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={item.active ? "page" : undefined}
              className={underlineTabItemClass(!!item.active)}
            >
              <SubtabLabel label={item.label} icon={item.icon} />
            </Link>
          ))}
      </span>
      {hasDoc && (
        <span className={tabBarActionsClass}>
          <PageDocButton />
        </span>
      )}
    </nav>
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
   * The page's own title, rendered as part of this row. Under dali.os it sits
   * at the left — one line instead of a title stacked above a rail of pills.
   * The switcher is pushed to the far right either way, so a row with no
   * heading still ends on the same edge as one that has it. The brand shell's
   * row is a full-width underline bar with no room beside it, so there the
   * title renders above it.
   */
  heading?: ReactNode;
}) {
  const matches = useMatches();
  const hasDoc = matches.some(
    (m) => (m as { handle?: { docKey?: string } }).handle?.docKey,
  );
  const showHistoryNav = useShowTablessHistoryNav();
  const osRedesign = useFeatureFlag("os-redesign");

  if (osRedesign) {
    return (
      // No Guide button here: the os top bar already carries it, so the inline
      // copy would be the second one on screen. The history arrows stay —
      // hasSubnavRow still counts this page as owning a row, so the shell's
      // standalone arrow bar is standing down for it.
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {showHistoryNav && <TablessHistoryNavInline />}
        {heading}
        <div
          className={cn(osSegmentedTrackClass, "ml-auto")}
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
      </div>
    );
  }

  const bar = (
    <div className={underlineTabBarClass} role="tablist" aria-label={label}>
      {showHistoryNav && (
        <span className={tabBarLeadingClass}>
          <TablessHistoryNavInline />
        </span>
      )}
      <span className={underlineTabListClass}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={item.active ?? false}
            onClick={item.onClick}
            className={underlineTabItemClass(!!item.active)}
          >
            <SubtabLabel label={item.label} icon={item.icon} />
          </button>
        ))}
      </span>
      {hasDoc && (
        <span className={tabBarActionsClass}>
          <PageDocButton />
        </span>
      )}
    </div>
  );

  if (!heading) return bar;
  return (
    <>
      {heading}
      {bar}
    </>
  );
}
