import type { ReactNode } from "react";

/**
 * Shared presentational error card — the single look for every "this screen
 * broke" state so the root boundary, the applicant portal, and any future
 * boundary don't drift. Callers own the copy and the recovery actions (passed
 * as `children`); this only owns the layout, the warning glyph, and the
 * dev-only stack trace. Every use of this MUST render at least one action so
 * the user is never left with nowhere to go.
 */
export function ErrorScreen({
  heading,
  description,
  children,
  stack,
}: {
  heading: string;
  description: string;
  /** Recovery actions (buttons / links). Always render at least one. */
  children?: ReactNode;
  /** Dev-only stack trace; omit in production. */
  stack?: string;
}) {
  return (
    <div className="max-w-2xl mx-auto py-16 px-6">
      <div className="rounded-2xl bg-card border border-border px-6 py-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-coral/15 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-accent-coral"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">
          {heading}
        </h2>
        <p className="text-muted-foreground leading-relaxed mb-8">
          {description}
        </p>
        {children && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {children}
          </div>
        )}
        {stack && (
          <pre className="mt-6 text-left w-full p-4 overflow-x-auto rounded-lg bg-muted text-xs">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
