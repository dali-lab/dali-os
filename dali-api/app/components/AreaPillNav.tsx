import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

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
  // A lone tab is pure noise — the page is already the only destination.
  if (items.length <= 1) return null;
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
    </div>
  );
}
