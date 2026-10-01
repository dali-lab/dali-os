import { useEffect, useRef } from "react";
import { Calendar } from "lucide-react";

export type RibbonTerm = {
  id: string;
  code: string;
  sortKey: number;
  isCurrent: boolean;
  projectCount: number;
  partnerCount: number;
};

// Horizontal scroller of nearby terms. Clicking a chip calls back so the hub
// can mount the TermMatrix modal; per-cell staffing edits still live under
// /projects/staffing (where the per-role request CRUD already is).
export function TermRibbon({
  terms,
  onPick,
}: {
  terms: RibbonTerm[];
  onPick: (termId: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const currentId = terms.find((t) => t.isCurrent)?.id;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !currentId) return;
    const target = el.querySelector<HTMLElement>(`[data-term-id="${currentId}"]`);
    if (target) {
      el.scrollTo({ left: Math.max(0, target.offsetLeft - 20), behavior: "auto" });
    }
  }, [currentId]);

  return (
    <section className="rounded-os-card bg-os-card overflow-hidden">
      <header className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Calendar className="h-4 w-4 text-os-grey" aria-hidden />
        <div>
          <h2 className="section-title text-foreground">Terms</h2>
          <p className="text-xs text-muted-foreground">
            Click a chip to open the staffing matrix for that term.
          </p>
        </div>
      </header>
      <div ref={scrollerRef} className="overflow-x-auto">
        <div className="flex gap-2 p-3 min-w-max">
          {terms.map((t) => (
            <button
              key={t.id}
              data-term-id={t.id}
              type="button"
              onClick={() => onPick(t.id)}
              className={
                t.isCurrent
                  ? "shrink-0 w-[172px] text-left rounded-os-item border border-os-accent bg-os-accent/10 px-3 py-2.5"
                  : "shrink-0 w-[172px] text-left rounded-os-item border border-border bg-os-well px-3 py-2.5 hover:border-os-container-hi"
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{t.code}</span>
                {t.isCurrent && (
                  <span className="rounded-full border border-os-accent bg-os-accent px-2 py-0.5 text-[10px] font-semibold text-os-bg">
                    now
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <div>
                  <div className="text-lg font-semibold leading-none tabular-nums text-foreground">
                    {t.projectCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">projects</div>
                </div>
                <div>
                  <div className="text-lg font-semibold leading-none tabular-nums text-foreground">
                    {t.partnerCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">partners</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
