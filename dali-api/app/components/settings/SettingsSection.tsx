import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

// A settings group: title and explanation in a left column on desktop, the
// controls on a surface beside it.
export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-6 gap-4 border-t border-os-container/70 pt-8 first:border-t-0 first:pt-0 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="font-heading text-[19px] font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-sm text-os-grey">{description}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingRow({
  label,
  help,
  control,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-6 px-6 py-4", className)}>
      <div className="min-w-0">
        <p className="text-[15px] text-foreground">{label}</p>
        {help && <p className="mt-0.5 text-sm text-os-grey">{help}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** A list row's leading glyph tile. */
export function SettingsIconTile({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-os-item",
        accent ? "bg-os-accent/15 text-os-accent" : "bg-os-well text-os-grey",
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

/** The outlined red pill for a destructive row action (Disconnect, Revoke). */
export const settingsDangerBtn =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50";

/** A divided list on the settings surface. */
export const settingsList = "rounded-os-card bg-os-card divide-y divide-os-container/70";

export function SettingsEmptyRow({ children }: { children: ReactNode }) {
  return <li className="px-6 py-10 text-center text-sm text-os-muted">{children}</li>;
}
