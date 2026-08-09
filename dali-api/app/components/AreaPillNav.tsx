import { useMatches } from "react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { PageDocButton } from "~/components/page-docs/PageDocButton";

// Horizontal underline tabs for in-page view switching (e.g. the calendar's
// day/week/month toggle). Area-level navigation now lives in the sidebar's
// active-area dropdown (see app/lib/nav-areas.ts), so the old Link-based
// AreaPillNav was retired — only the button-driven UnderlineTabButtons remains.

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

// A 2px coral rule on a white page was doing all the work of saying "this tab
// is selected", and losing — at that weight the tint reads as a hairline rather
// than a state. The active tab now carries a 3px rule, a tinted body and
// rounded top corners so it reads as a tab sitting on the content below it,
// with the underline as reinforcement instead of the only signal.
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

export function UnderlineTabButtons({
  items,
  label = "Section",
}: {
  items: UnderlineTabButton[];
  label?: string;
}) {
  const matches = useMatches();
  const hasDoc = matches.some(
    (m) => (m as { handle?: { docKey?: string } }).handle?.docKey,
  );

  return (
    <div className={underlineTabBarClass} role="tablist" aria-label={label}>
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
}
