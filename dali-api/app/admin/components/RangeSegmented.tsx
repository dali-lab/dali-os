import { useNavigate } from "react-router";
import { Segmented } from "~/components/ui/Segmented";
import { DEFAULT_RANGE, RANGE_OPTIONS, type RangeKey } from "~/admin/lib/insights-range";

/** The Insights pages' 7/30/90 day switch, kept in `?range=`. */
export function RangeSegmented({ value }: { value: RangeKey }) {
  const navigate = useNavigate();
  return (
    <Segmented<RangeKey>
      ariaLabel="Date range"
      value={value}
      onChange={(next) =>
        navigate(next === DEFAULT_RANGE ? "?" : `?range=${next}`, { preventScrollReset: true })
      }
      options={RANGE_OPTIONS.map((r) => ({ value: r.key, label: r.label }))}
    />
  );
}
