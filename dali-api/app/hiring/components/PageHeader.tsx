import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "~/lib/cn";

// The consistent top of every hiring page: a title in Dosis, an optional
// one-line subtitle, an optional cycle/status chip, and an optional row of
// actions on the right. Optionally preceded by a compact "back" link for detail
// pages. Every hiring surface opens the same way so the area reads as one
// product rather than a dozen separately-built screens.
export function PageHeader({
  title,
  subtitle,
  chip,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  chip?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { label: string; to: string };
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {back && (
        <Link
          to={back.to}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-accent-coral"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-heading text-2xl font-bold text-foreground">
              {title}
            </h1>
            {chip}
          </div>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
