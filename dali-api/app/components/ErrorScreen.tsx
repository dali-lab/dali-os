import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Shared presentational error card — the single look for every "this screen
 * broke" state so the root boundary, the applicant portal, and any future
 * boundary don't drift. Callers own the copy and the recovery actions (passed
 * as `children`); this only owns the layout, the warning glyph, and the
 * dev-only stack trace. Every use of this MUST render at least one action so
 * the user is never left with nowhere to go.
 *
 * Draws from the os tokens, so it needs an `.os-shell` ancestor; the root
 * boundary supplies its own because no layout route rendered.
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
      <div className="rounded-os-card bg-os-card px-6 py-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-os-well flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-os-accent" aria-hidden="true" />
        </div>
        <h2 className="font-heading text-2xl font-semibold text-foreground mb-3">
          {heading}
        </h2>
        <p className="text-sm text-os-grey leading-relaxed mb-8">{description}</p>
        {children && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {children}
          </div>
        )}
        {stack && (
          <pre className="mt-6 text-left w-full p-4 overflow-x-auto rounded-os-item bg-os-well text-xs text-foreground">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
