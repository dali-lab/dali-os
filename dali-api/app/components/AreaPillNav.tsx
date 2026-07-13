import { Link } from "react-router";
import { cn } from "~/lib/cn";

// Horizontal pill navigation between an area's sibling surfaces. Used where a
// sidebar area collapsed to a single entry: the area's landing page carries
// its role-gated sub-surfaces here instead of as sidebar children. Callers
// pass only the pills the viewer may access.

export type AreaPill = { label: string; to: string; active?: boolean };

export function AreaPillNav({ items }: { items: AreaPill[] }) {
  // A lone pill is pure noise — the page is already the only destination.
  if (items.length <= 1) return null;
  return (
    <nav className="flex items-center gap-1.5 flex-wrap" aria-label="Section">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold font-heading transition-colors",
            item.active
              ? "bg-accent-coral text-white"
              : "bg-muted text-muted-foreground hover:text-foreground hover:bg-border",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
