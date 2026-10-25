import { useState } from "react";
import { CheckCircle2, Circle, Loader } from "lucide-react";
import type { Lab } from "~/journeys/lib/types";
import { cn } from "~/lib/cn";
import { InlineText } from "~/journeys/components/InlineText";

export function LabGuide({ lab, results, checking }: { lab: Lab; results: Record<string, boolean>; checking: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [hints, setHints] = useState<Set<string>>(new Set());

  const passed = lab.steps.filter((s) => results[s.id]).length;
  const currentIndex = lab.steps.findIndex((s) => !results[s.id]);
  const expandedId = openId ?? lab.steps[currentIndex]?.id ?? null;

  const toggleHint = (id: string) =>
    setHints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="h-full overflow-y-auto p-5">
      <p className="text-xs font-medium text-os-muted">Guide</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{lab.title}</h2>
      {lab.intro && (
        <p className="mt-2 text-sm leading-6 text-os-grey">
          <InlineText text={lab.intro} />
        </p>
      )}

      <p className="mt-5 flex items-center gap-2 text-xs text-os-grey" aria-live="polite">
        {checking ? (
          <>
            <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Checking your code
          </>
        ) : (
          <>
            <span className="tabular-nums text-foreground">
              {passed}/{lab.steps.length}
            </span>
            checks passing · runs as you type
          </>
        )}
      </p>

      <ol className="mt-3 space-y-1.5">
        {lab.steps.map((step, i) => {
          const done = Boolean(results[step.id]);
          const isOpen = expandedId === step.id;
          return (
            <li key={step.id} className={cn("rounded-os-item", isOpen && "bg-os-card")}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? "" : step.id)}
                className="flex w-full items-start gap-3 p-3 text-left"
              >
                {done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-os-green" aria-label="Passed" />
                ) : i === currentIndex ? (
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-os-accent" aria-label="Current step" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-os-muted" aria-label="Not passed" />
                )}
                <span className={cn("text-sm font-medium", done ? "text-os-grey" : "text-foreground")}>{step.title}</span>
              </button>
              {isOpen && (
                <div className="pb-4 pl-10 pr-4">
                  <p className="text-sm leading-6 text-foreground/85">
                    <InlineText text={step.instructions} />
                  </p>
                  {step.hint && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleHint(step.id)}
                        className="text-xs font-medium text-os-accent hover:underline"
                      >
                        {hints.has(step.id) ? "Hide hint" : "Show hint"}
                      </button>
                      {hints.has(step.id) && (
                        <p className="mt-2 text-xs leading-5 text-os-grey">
                          <InlineText text={step.hint} />
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
