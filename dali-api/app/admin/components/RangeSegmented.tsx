import { X } from "lucide-react";
import { useNavigate } from "react-router";
import { Segmented } from "~/components/ui/Segmented";
import { DEFAULT_RANGE, INSIGHTS_RANGE_OPTIONS, type InsightsRangeKey } from "~/admin/lib/insights-range";

/**
 * The Insights pages' 7/30/90 day and all-time switch, kept in `?range=`. A dragged range
 * (`customLabel`) shows as a chip that clears back to the default.
 */
export function RangeSegmented({ value, customLabel }: { value: InsightsRangeKey | null; customLabel?: string }) {
  const navigate = useNavigate();
  const go = (search: string) => navigate(search, { preventScrollReset: true });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value === null && customLabel && (
        <button
          type="button"
          onClick={() => go("?")}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-os-accent/40 bg-os-accent/10 px-2.5 text-xs font-medium text-foreground hover:bg-os-accent/15"
          aria-label={`Clear range ${customLabel}`}
        >
          {customLabel}
          <X className="h-3 w-3 text-os-muted" />
        </button>
      )}
      <Segmented<InsightsRangeKey>
        ariaLabel="Date range"
        value={value as InsightsRangeKey}
        onChange={(next) => go(next === DEFAULT_RANGE ? "?" : `?range=${next}`)}
        options={INSIGHTS_RANGE_OPTIONS.map((r) => ({ value: r.key, label: r.label }))}
      />
    </div>
  );
}
