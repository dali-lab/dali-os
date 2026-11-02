import { cn } from "~/lib/cn";

const HATCH =
  "repeating-linear-gradient(135deg, var(--color-os-accent) 0 2px, transparent 2px 5px)";

export function SourceBar({
  renewing,
  fresh,
  intent,
  scale,
  className,
}: {
  renewing: number;
  fresh: number;
  /** Intent-to-work count for the same domain; drawn as a thin second track on
   *  the same scale, with the number at the end of its bar. */
  intent?: number;
  scale: number;
  className?: string;
}) {
  const pct = (n: number) => (scale > 0 ? `${Math.min(100, (n / scale) * 100)}%` : "0%");
  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" aria-hidden>
        {renewing > 0 && (
          <div className="h-full bg-os-accent" style={{ width: pct(renewing) }} />
        )}
        {fresh > 0 && (
          <div
            className="h-full bg-os-card"
            style={{
              width: pct(fresh),
              backgroundImage: HATCH,
              boxShadow: "inset 0 0 0 1px var(--color-os-accent)",
            }}
          />
        )}
      </div>
      {intent !== undefined && intent > 0 && (
        <div className="flex items-center gap-1.5" aria-hidden>
          <div className="h-1.5 rounded-full bg-os-grey/50" style={{ width: pct(intent) }} />
          <span className="text-[10px] font-medium leading-none tabular-nums text-muted-foreground">
            {intent}
          </span>
        </div>
      )}
    </div>
  );
}
