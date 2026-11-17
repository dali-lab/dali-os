import { useState, useEffect } from "react";

import type { Section } from "~/hiring/lib/apply-sections";

function scrollToSection(id: string) {
  const el = document.getElementById(`section-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SectionNavMobile({
  sections,
  activeSection,
}: {
  sections: Section[];
  activeSection: string | null;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="lg:hidden flex gap-2 overflow-x-auto pb-2">
      {sections.map(s => {
        const isActive = s.id === activeSection;
        const isComplete = s.requiredCount > 0 && s.answeredRequiredCount === s.requiredCount;
        const dotColor = s.color?.bg ?? "bg-os-accent";
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollToSection(s.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              isActive
                ? "bg-os-accent text-os-bg border-os-accent"
                : "bg-card text-foreground border-border hover:border-os-accent"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
            <span>{s.label}</span>
            {s.requiredCount > 0 && (
              isComplete ? (
                <svg className="w-3.5 h-3.5 text-os-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className={isActive ? "text-white/80" : "text-muted-foreground"}>
                  {s.answeredRequiredCount}/{s.requiredCount}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SectionNavDesktop({
  sections,
  activeSection,
}: {
  sections: Section[];
  activeSection: string | null;
}) {
  if (sections.length === 0) return null;
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2">
          Sections
        </p>
        {sections.map(s => {
          const isActive = s.id === activeSection;
          const isComplete = s.requiredCount > 0 && s.answeredRequiredCount === s.requiredCount;
          const dotColor = s.color?.bg ?? "bg-os-accent";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition text-left ${
                isActive
                  ? "bg-os-container text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
              <span className="flex-1 truncate">{s.label}</span>
              {s.requiredCount > 0 && (
                isComplete ? (
                  <svg className="w-4 h-4 text-os-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {s.answeredRequiredCount}/{s.requiredCount}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 600);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="fixed bottom-6 right-6 z-30 w-11 h-11 rounded-full bg-os-accent text-os-bg shadow-lg hover:bg-os-accent-hover transition flex items-center justify-center"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    </button>
  );
}
