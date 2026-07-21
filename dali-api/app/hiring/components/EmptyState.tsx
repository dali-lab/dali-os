import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";

// A blank surface is a moment for direction, not a dead end. One icon, a plain
// headline of what's true, one line of what happens next, and — where there is
// a next step — a single action. Shared by every hiring dashboard so "nothing
// here yet" always looks and reads the same way.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; to: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <p className="font-heading text-base font-semibold text-foreground">
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && (
        <Link to={action.to} className={buttonClasses("primary", "sm", "mt-4")}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
