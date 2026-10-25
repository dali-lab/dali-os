import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cn } from "~/lib/cn";

// A section page's head: title, one line of explanation, and the row of tabs
// that switches between its tools. The breadcrumb above it comes from the
// route's `handle`, so the header doesn't draw one.

export function OsPageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-heading text-4xl font-medium text-foreground">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-os-grey">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export type OsTab = { key: string; label: string; to: string };

export function OsTabStrip({ label, tabs }: { label: string; tabs: OsTab[] }) {
  return (
    <nav
      aria-label={label}
      className="no-scrollbar flex gap-7 overflow-x-auto border-b border-os-container"
    >
      {tabs.map((t) => (
        <NavLink
          key={t.key}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "-mb-px whitespace-nowrap border-b-2 pb-3 text-[15px] transition-colors",
              isActive
                ? "border-os-accent font-semibold text-foreground"
                : "border-transparent text-os-grey hover:text-foreground",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The header and tab strip together, spaced as the design stacks them. */
export function OsSectionHead({
  title,
  description,
  actions,
  tabsLabel,
  tabs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabsLabel: string;
  tabs: OsTab[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <OsPageHeader title={title} description={description} actions={actions} />
      <OsTabStrip label={tabsLabel} tabs={tabs} />
    </div>
  );
}
