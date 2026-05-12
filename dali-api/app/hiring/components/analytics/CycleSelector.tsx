import { useNavigate, useSearchParams } from "react-router";

interface CycleSelectorProps {
  cycles: Array<{ id: string; name: string; status: string }>;
  selectedCycleId: string;
}

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-muted text-foreground/80",
  Open: "bg-green-100 text-green-700",
  UnderReview: "bg-yellow-100 text-yellow-700",
  Completed: "bg-blue-100 text-blue-700",
};

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Open: "Open",
  UnderReview: "Under Review",
  Completed: "Completed",
};

export function CycleSelector({ cycles, selectedCycleId }: CycleSelectorProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedCycle = cycles.find((c) => c.id === selectedCycleId);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams);
    params.set("cycleId", e.target.value);
    navigate(`/hiring/analytics?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={selectedCycleId}
        onChange={handleChange}
        className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {cycles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
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
