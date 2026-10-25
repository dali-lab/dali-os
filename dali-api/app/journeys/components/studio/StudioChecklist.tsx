import { Check, Clock, X } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { cn } from "~/lib/cn";
import type { CheckMode, CriterionResult } from "~/journeys/lib/studio-types";

const GROUPS: { mode: CheckMode; title: string; hint: string }[] = [
  { mode: "auto", title: "Checked automatically", hint: "Updates as you work." },
  { mode: "self", title: "Check your own work", hint: "Tick each one once it's true." },
  { mode: "mentor", title: "Mentor review", hint: "A lead checks these after you submit." },
];

function StateMark({ mode, state }: { mode: CheckMode; state: CriterionResult["state"] }) {
  if (state === "pending") return <Clock className="mt-0.5 h-4 w-4 shrink-0 text-os-amber" aria-label="Waiting for review" />;
  return (
    <span
      className={cn(
        "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
        state === "pass" && "bg-os-green text-os-bg",
        state === "fail" && (mode === "mentor" ? "bg-destructive text-os-bg" : "border-2 border-os-container"),
      )}
      aria-label={state === "pass" ? "Done" : "Not yet"}
    >
      {state === "pass" && <Check className="h-3 w-3" strokeWidth={3} />}
      {state === "fail" && mode === "mentor" && <X className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

/** A lab's criteria grouped by how they're checked. Self-checks are ticked here. */
export function StudioChecklist({
  results,
  canTick,
  onToggleSelf,
}: {
  results: CriterionResult[];
  canTick: boolean;
  onToggleSelf: (criterionId: string) => void;
}) {
  return (
    <div className="space-y-7">
      {GROUPS.map(({ mode, title, hint }) => {
        const rows = results.filter((r) => r.criterion.mode === mode);
        if (rows.length === 0) return null;
        return (
          <section key={mode} aria-labelledby={`checks-${mode}`}>
            <h3 id={`checks-${mode}`} className="text-xs font-medium text-os-grey">
              {title}
            </h3>
            <p className="mt-0.5 text-xs text-os-muted">{hint}</p>
            <ul className="mt-3 space-y-3">
              {rows.map(({ criterion, state, detail }) => (
                <li key={criterion.id} className="flex items-start gap-3">
                  {mode === "self" ? (
                    <Checkbox
                      tone="os"
                      className="min-w-0 flex-1"
                      checked={state === "pass"}
                      disabled={!canTick}
                      onChange={() => onToggleSelf(criterion.id)}
                      label={criterion.label || "Untitled criterion"}
                      description={criterion.description}
                    />
                  ) : (
                    <>
                      <StateMark mode={mode} state={state} />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm leading-5", state === "pass" ? "text-foreground" : "text-foreground/85")}>
                          {criterion.label || "Untitled criterion"}
                        </p>
                        {criterion.description && <p className="mt-0.5 text-xs leading-5 text-os-muted">{criterion.description}</p>}
                      </div>
                    </>
                  )}
                  {detail && (
                    <span className={cn("shrink-0 text-xs tabular-nums", state === "pass" ? "text-os-green" : "text-os-muted")}>{detail}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
