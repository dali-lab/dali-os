import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

export type SettingsNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

export function SettingsLayout({
  nav,
  children,
}: {
  nav: SettingsNavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      <nav
        className="lg:w-44 flex-shrink-0 lg:sticky lg:top-0"
        aria-label="Settings sections"
      >
        <ul className="flex flex-row flex-wrap gap-1 lg:flex-col lg:gap-0.5">
          {nav.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={cn(
                  "inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function SettingsBlock({
  id,
  title,
  description,
  children,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Deep-link / sidebar jump opens the target section.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash.slice(1) === id) setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [id]);

  return (
    <section id={id} className="scroll-mt-6 border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div id={`${id}-panel`} className="border-t border-border px-4 py-5">
          {children}
        </div>
      )}
    </section>
  );
}
