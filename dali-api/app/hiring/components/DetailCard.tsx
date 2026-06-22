import type React from "react";

// Shared card shell for the hiring detail routes: rounded-xl card with a
// muted header band (title + optional subtitle + optional right-aligned extra)
// and an arbitrary body. This is a hiring-local composition — the global
// ~/components/ui/Card uses a different visual contract (rounded-lg +
// shadow-brand-1, no header slot) and does not cover this shell.
export function DetailCard({
  title,
  subtitle,
  headerExtra,
  children,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section
      className={`bg-card rounded-xl border border-border shadow-sm${className ? ` ${className}` : ""}`}
    >
      <div className="px-6 py-4 border-b border-border bg-muted/50 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          {subtitle != null && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {headerExtra != null && <div className="flex-shrink-0">{headerExtra}</div>}
      </div>
      {children}
    </section>
  );
}
