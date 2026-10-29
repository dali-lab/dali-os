import { useState } from "react";
import { X } from "lucide-react";
import { DEFAULT_RANGE, RANGE_OPTIONS, resolveRange, type RangeKey } from "~/admin/lib/insights-range";
import { Segmented } from "~/components/ui/Segmented";
import { addDays, dayKey, rangeLabel } from "./chart-range";

export type ChartRange = {
  from: string;
  to: string;
  preset: RangeKey;
  zoom: { from: string; to: string } | null;
  setPreset: (next: RangeKey) => void;
  setZoom: (range: { from: string; to: string } | null) => void;
};

/** A 7/30/90 day window ending `today`, narrowed by a dragged zoom until it is cleared. */
export function useChartRange(today = dayKey(new Date())): ChartRange {
  const [preset, setPresetState] = useState<RangeKey>(DEFAULT_RANGE);
  const [zoom, setZoom] = useState<{ from: string; to: string } | null>(null);
  return {
    from: zoom?.from ?? addDays(today, -(resolveRange(preset).days - 1)),
    to: zoom?.to ?? today,
    preset,
    zoom,
    setPreset: (next) => {
      setZoom(null);
      setPresetState(next);
    },
    setZoom,
  };
}

export function ChartRangeControls({ range }: { range: ChartRange }) {
  const { zoom } = range;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {zoom && (
        <button
          type="button"
          onClick={() => range.setZoom(null)}
          className="inline-flex h-6 items-center gap-1.5 rounded-lg border border-os-accent/40 bg-os-accent/10 px-2.5 text-xs font-medium text-foreground hover:bg-os-accent/15"
          aria-label={`Clear range ${rangeLabel(zoom.from, zoom.to)}`}
        >
          {rangeLabel(zoom.from, zoom.to)}
          <X className="h-3 w-3 text-os-muted" />
        </button>
      )}
      <Segmented<RangeKey>
        ariaLabel="Date range"
        value={(zoom ? null : range.preset) as RangeKey}
        onChange={range.setPreset}
        options={RANGE_OPTIONS.map((r) => ({ value: r.key, label: r.label }))}
      />
    </div>
  );
}
