import { Link, useMatches } from "react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { PageDocButton } from "~/components/page-docs/PageDocButton";

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

const underlineTabBarClass = cn(
  "flex items-stretch gap-0.5 flex-wrap border-b border-border mb-6 sm:mb-8",
  // Bleed to the iframe edges; tab items carry their own px-3 (matches workspace tabs).
  "-mx-3 sm:-mx-6 lg:-mx-10",
);

function underlineTabItemClass(active: boolean) {
  return cn(
    "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold font-heading border-b-2 -mb-px transition-colors",
    active
      ? "border-accent-coral text-accent-coral"
      : "border-transparent text-muted-foreground hover:text-foreground",
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

  // A lone tab is pure noise — the page is already the only destination.
  if (items.length <= 1) return null;

  // The pill row is the natural home for a page-level action, so the "Docs"
  // icon rides the row's right edge rather than floating in a row of its own
  // above it. It's the last flex item pushed right by ml-auto, so it sits at
  // the nav's bled right edge — mirroring the tabs that bleed off the left —
  // rather than inset to the content column. self-center vertically centers it
  // on the tab band (within the flex line, not the collapsed-in bottom margin),
  // so it stays clear of the row's bottom border.
  return (
    <nav className={cn(underlineTabBarClass, className)} aria-label="Section">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={item.active ? "page" : undefined}
          className={underlineTabItemClass(!!item.active)}
        >
          <SubtabLabel label={item.label} icon={item.icon} />
        </Link>
      ))}
      {hasDoc && (
        <span className="ml-auto flex items-center self-center pl-2 pr-2">
          <PageDocButton />
        </span>
      )}
    </nav>
  );
}

export function UnderlineTabButtons({
  items,
  label = "Section",
}: {
  items: UnderlineTabButton[];
  label?: string;
}) {
  // Mirrors AreaPillNav: a page-level "Docs" button rides the row's right edge
  // when this page declares a guide, so button-tab landings (e.g. Calendar) get
  // the same docs affordance as pill landings.
  const matches = useMatches();
  const hasDoc = matches.some(
    (m) => (m as { handle?: { docKey?: string } }).handle?.docKey,
  );

  return (
    <div className={underlineTabBarClass} role="tablist" aria-label={label}>
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
      {hasDoc && (
        <span className="ml-auto flex items-center self-center pl-2 pr-2">
          <PageDocButton />
        </span>
      )}
    </div>
  );
}
