import type { Level } from "~/lib/level";
import { ALL_LEVELS } from "~/lib/level";

const LEVEL_CLS: Record<Level, string> = {
  P1: "border-border bg-muted text-muted-foreground",
  P2: "border-accent-teal/40 bg-accent-teal/10 text-accent-teal",
  P3: "border-accent-coral/40 bg-accent-coral/10 text-accent-coral",
};

// Compact P1/P2/P3 control for an assigned staffing card. Changing level
// rewrites the live StaffingAssignment (Proposed) so Propagate can confirm it.
export function LevelBadge({
  level,
  onChange,
}: {
  level: Level;
  onChange: (next: Level) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Assignment level"
      className="inline-flex items-center gap-0.5"
    >
      {ALL_LEVELS.map((l) => {
        const active = l === level;
        return (
          <button
            key={l}
            type="button"
            aria-pressed={active}
            title={`Set level to ${l}`}
            aria-label={`Level ${l}${active ? " (current)" : ""}`}
            onClick={() => {
              if (!active) onChange(l);
            }}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
              active
                ? LEVEL_CLS[l]
                : "border-transparent text-muted-foreground/60 hover:text-foreground hover:bg-muted"
            }`}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
