// Shared presentation primitives for the Admin "system console" hub and its
// system-level pages (activity, ai-usage, email-senders, outbound-messages).
// One status vocabulary across all of them — ok / warn / bad / idle — so a
// green/amber/red dot means the same thing everywhere. Pure client components
// (no server imports); everything is DALI theme tokens, so light + dark both
// work.
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

export type Tone = "ok" | "warn" | "bad" | "idle";

const DOT: Record<Tone, string> = {
  ok: "bg-os-green",
  warn: "bg-os-amber",
  bad: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

const FILL: Record<Tone, string> = {
  ok: "bg-os-green",
  warn: "bg-os-amber",
  bad: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

/** A small status dot. Same three colors everywhere: ok · warn · bad. */
export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[tone], className)}
      aria-hidden
    />
  );
}

/** The tone for a value against an optional cap: over → bad, ≥80% → warn. */
export function usageTone(value: number, max: number | null): Tone {
  if (max == null || max <= 0) return "idle";
  if (value >= max) return "bad";
  if (value / max >= 0.8) return "warn";
  return "ok";
}

/**
 * A capacity gauge — a thin bar that fills toward `max` and colors by
 * `usageTone`. With no cap it renders an empty track (nothing to fill toward).
 */
export function UsageGauge({
  value,
  max,
  className,
}: {
  value: number;
  max: number | null;
  className?: string;
}) {
  const pct = max && max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = usageTone(value, max);
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-all", FILL[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A proportion bar (0..1) for leaderboard rows. */
export function MiniBar({ fraction, className }: { fraction: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-os-accent/70"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A tiny inline bar sparkline from a daily-count series. */
export function Sparkline({
  values,
  className,
  height = 28,
}: {
  values: number[];
  className?: string;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  return (
    <div
      className={cn("flex items-end gap-px", className)}
      style={{ height }}
      aria-hidden
    >
      {values.map((v, i) => (
        <div
          key={i}
          className="min-w-px flex-1 rounded-sm bg-os-accent/50"
          style={{ height: `${Math.max(4, Math.round((v / max) * 100))}%` }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

/** The status pill: one neutral shape, with the state carried by its dot. */
export function Pill({ tone, children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-os-container/70 px-2.5 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      {tone && <StatusDot tone={tone} />}
      {children}
    </span>
  );
}

/** A headline number with its label above it. */
export function Figure({
  label,
  value,
  detail,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold text-os-muted">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-heading font-semibold tabular-nums text-foreground",
          size === "lg" ? "text-4xl" : "text-2xl",
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-os-grey">{detail}</p>}
    </div>
  );
}

/** Table dress for the admin pages' full-width tables. */
export const adminTable = {
  wrap: "rounded-os-card bg-os-card overflow-x-auto",
  th: "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-os-muted first:pl-6 last:pr-6",
  td: "px-4 py-3.5 text-sm first:pl-6 last:pr-6",
  row: "border-t border-os-container/70",
};

/** An empty list or table, said plainly. */
export function EmptyState({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      {title && <p className="font-semibold text-foreground">{title}</p>}
      {children && <p className={cn("text-sm text-os-muted", title ? "mt-1" : undefined)}>{children}</p>}
    </div>
  );
}
