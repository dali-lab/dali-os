// Compact 4-step strip showing where the hiring cycle is in its lifecycle.
// Replaces the dense "Checklist to Open Applications" card on the cycle
// management page — same intent (telegraph current phase + what's next)
// but at-a-glance, not a 5-bullet list.
//
// Doesn't gate actions — the actual status-advance button and the open-
// without-rubric guard live elsewhere on the page. This is signal only.

import { Check } from "lucide-react";

const PHASES = [
  { key: "Draft", label: "Draft" },
  { key: "Open", label: "Open" },
  { key: "UnderReview", label: "Under Review" },
  { key: "Completed", label: "Complete" },
] as const;

type Phase = (typeof PHASES)[number]["key"];

export function PhaseProgressStrip({ status }: { status: string }) {
  const currentIdx = PHASES.findIndex((p) => p.key === status);

  return (
    <ol className="flex items-center gap-1 sm:gap-2 w-full text-xs">
      {PHASES.map((p, i) => {
        const isPast = i < currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <li key={p.key} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                  isPast
                    ? "bg-green-100 text-green-700 border border-green-300"
                    : isCurrent
                      ? "bg-accent-coral text-white"
                      : "bg-muted text-muted-foreground border border-border"
                }`}
              >
                {isPast ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span
                className={`truncate font-medium ${
                  isCurrent
                    ? "text-foreground"
                    : isPast
                      ? "text-muted-foreground"
                      : "text-muted-foreground/70"
                }`}
              >
                {p.label}
              </span>
            </div>
            {i < PHASES.length - 1 && (
              <div
                className={`flex-1 h-px mx-2 sm:mx-3 ${
                  isPast ? "bg-green-300" : "bg-border"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type { Phase };
