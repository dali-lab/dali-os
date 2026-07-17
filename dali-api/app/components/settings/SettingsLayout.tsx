import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

// One-section-at-a-time settings shell: the side nav is a switcher, not a
// scroll index. Anchor items drive the URL hash (SettingsPage derives the
// visible section from it, so old /settings#devices deep links keep
// working); items with `to` navigate to their own page instead (the
// notifications matrix).

export type SettingsNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  // Full page of its own — renders as a route link, not a section switch.
  to?: string;
};

export function SettingsLayout({
  nav,
  active,
  children,
}: {
  nav: SettingsNavItem[];
  active: string;
  children: React.ReactNode;
}) {
  const itemClass = (isActive: boolean) =>
    cn(
      "inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      isActive
        ? "bg-accent-coral/10 text-accent-coral"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
    );

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      <nav
        className="lg:w-44 flex-shrink-0 lg:sticky lg:top-0"
        aria-label="Settings sections"
      >
        <ul className="flex flex-row flex-wrap gap-1 lg:flex-col lg:gap-0.5">
          {nav.map(({ id, label, icon: Icon, to }) => (
            <li key={id}>
              {to ? (
                <Link to={to} className={itemClass(false)}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {label}
                </Link>
              ) : (
                <a
                  href={`#${id}`}
                  aria-current={active === id ? "page" : undefined}
                  className={itemClass(active === id)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 flex flex-col gap-4">{children}</div>
    </div>
  );
}

// A single settings section. Always expanded — only the active section is
// mounted, so the old accordion collapse has nothing left to do.
export function SettingsBlock({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border border-border rounded-lg">
      <div className="px-4 py-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="border-t border-border px-4 py-5">{children}</div>
    </section>
  );
}
