import { cn } from "~/lib/cn";

/**
 * Small pill chip surfacing CE credit standing in the hub header row.
 * Renders nothing when ceStanding is null (portal surface passes null).
 */
export function CEChip({
  ceStanding,
}: {
  ceStanding: { termCode: string; credits: number; compliant: boolean } | null;
}) {
  if (!ceStanding) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        ceStanding.compliant
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700",
      )}
    >
      {ceStanding.compliant ? (
        <>
          <span className="text-emerald-500">✓</span>
          CE {ceStanding.credits}/{ceStanding.credits} done
        </>
      ) : (
        <>
          CE {ceStanding.credits}/1 · attend a session
        </>
      )}
    </span>
  );
}
