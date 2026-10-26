import { useEffect, useState, type ReactNode } from "react";
import { DinoGame } from "~/components/dino/DinoGame";

// The one look for every "this screen broke" state: the root boundary, the
// applicant portal and the partner portal all render it. Callers own the copy
// and the way out, passed as children, and must always give at least one.
// It draws from the os tokens, so it needs an .os-shell ancestor; the root
// boundary supplies its own because no layout route rendered.
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
  // The game needs the browser; rendering it only after mount keeps the
  // server and first client paint identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-4xl font-medium text-foreground">{heading}</h1>
        <p className="max-w-xl text-base text-os-grey leading-relaxed">{description}</p>
        {children && <div className="mt-2 flex flex-wrap items-center gap-3">{children}</div>}
      </div>
      <section className="flex flex-col gap-4 rounded-os-card bg-os-card p-5" aria-label="While you wait">
        {mounted ? <DinoGame /> : <div className="h-[150px] rounded-os-item bg-os-well" />}
      </section>
      {stack && (
        <pre className="w-full overflow-x-auto rounded-os-item bg-os-well p-4 text-left text-xs text-foreground">
          <code>{stack}</code>
        </pre>
      )}
    </div>
  );
}
