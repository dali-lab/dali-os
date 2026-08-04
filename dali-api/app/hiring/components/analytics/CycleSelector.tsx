import { useNavigate, useSearchParams } from "react-router";
import { STATUS_COLORS, STATUS_LABELS } from "~/hiring/lib/labels";
import { Select } from "~/components/ui/floating";

interface CycleSelectorProps {
  cycles: Array<{ id: string; name: string; status: string }>;
  selectedCycleId: string;
}

export function CycleSelector({ cycles, selectedCycleId }: CycleSelectorProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedCycle = cycles.find((c) => c.id === selectedCycleId);

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams);
    params.set("cycleId", value);
    navigate({ search: `?${params.toString()}` });
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      <Select
        value={selectedCycleId}
        options={cycles.map((c) => ({ value: c.id, label: c.name }))}
        ariaLabel="Select hiring cycle"
        buttonClassName="inline-flex items-center justify-between gap-1 px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground transition-colors hover:bg-muted/40"
        onChange={handleChange}
      />
      {selectedCycle && (
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[selectedCycle.status] ?? "bg-muted text-foreground/80"}`}
        >
          {STATUS_LABELS[selectedCycle.status] ?? selectedCycle.status}
        </span>
      )}
    </div>
  );
}
