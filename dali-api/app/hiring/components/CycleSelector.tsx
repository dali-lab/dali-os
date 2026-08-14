import { useSearchParams } from "react-router";

export const CYCLE_TYPE_LABELS: Record<string, string> = {
  Standard: "Standard hire",
  Fellowship: "Fellowship",
};

export function CycleSelector({
  cycles,
  activeId,
}: {
  cycles: Array<{ id: string; name: string; cycleType: string }>;
  activeId: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  if (cycles.length < 2) return null;
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs">
      {cycles.map((c) => {
        const isActive = c.id === activeId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("cycle", c.id);
              setSearchParams(next, { replace: true });
            }}
            className={`px-3 py-1.5 rounded font-medium transition ${
              isActive
                ? "bg-accent-coral/15 text-accent-coral"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={c.name}
          >
            {CYCLE_TYPE_LABELS[c.cycleType] ?? c.cycleType}
          </button>
        );
      })}
    </div>
  );
}
