import { cn } from "~/lib/cn";

const HATCH =
  "repeating-linear-gradient(135deg, var(--color-os-accent) 0 2px, transparent 2px 5px)";

export function SourceBar({
  renewing,
  fresh,
  scale,
  className,
}: {
  renewing: number;
  fresh: number;
  scale: number;
  className?: string;
}) {
  const pct = (n: number) => (scale > 0 ? `${Math.min(100, (n / scale) * 100)}%` : "0%");
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full", className)} aria-hidden>
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
  );
}
