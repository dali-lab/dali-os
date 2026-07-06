import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

interface UserSubmissionRow {
  key: string;
  label: string;
  value: ReactNode;
  // When false, label is annotated "(not in table)" — matches the staffing
  // submission detail pages where managers need to see which form fields
  // aren't surfaced in the board table.
  mapped?: boolean;
}

interface UserSubmissionShellProps {
  title?: string;
  subtitle?: string;
  rows: UserSubmissionRow[];
  emptyMessage?: string;
  className?: string;
}

export function UserSubmissionShell({
  title,
  subtitle,
  rows,
  emptyMessage = "This submission is empty.",
  className,
}: UserSubmissionShellProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {(title || subtitle) && (
        <div>
          {title && (
            <h1 className="font-heading text-2xl font-bold text-foreground">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <dl className="bg-card border border-border rounded-lg divide-y divide-border">
          {rows.map((row) => (
            <div
              key={row.key}
              className="px-4 py-3 flex flex-col sm:flex-row sm:gap-4"
            >
              <dt className="sm:w-56 shrink-0 text-sm font-medium text-foreground">
                {row.label}
                {row.mapped === false && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    (not in table)
                  </span>
                )}
              </dt>
              <dd className="text-sm text-foreground mt-1 sm:mt-0 whitespace-pre-wrap break-words">
                {row.value === "" || row.value == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
