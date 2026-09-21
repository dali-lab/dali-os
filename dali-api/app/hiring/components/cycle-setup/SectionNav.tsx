import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "~/lib/cn";

// A tab's side nav: every top-level section declares itself with <NavSection>
// (a stable id and its title), and <SectionNavLayout> lists them in page order
// beside the content. Declaring beats scraping the DOM: the nav can only show
// sections that actually rendered for this cycle, under the names they chose.

type Entry = { id: string; title: string };

const NavContext = createContext<((entry: Entry) => () => void) | null>(null);

/** Page order, so the nav matches the stack whatever order sections mounted in. */
function byPosition(a: Entry, b: Entry) {
  const ea = document.getElementById(a.id);
  const eb = document.getElementById(b.id);
  if (!ea || !eb) return 0;
  return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function SectionNavLayout({ label, children }: { label: string; children: ReactNode }) {
  const [sections, setSections] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const register = useCallback((entry: Entry) => {
    setSections((prev) => [...prev.filter((s) => s.id !== entry.id), entry].sort(byPosition));
    return () => setSections((prev) => prev.filter((s) => s.id !== entry.id));
  }, []);

  // Highlight the topmost section in the upper part of the viewport.
  useEffect(() => {
    if (sections.length === 0) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = sections.find((s) => visible.has(s.id));
        if (first) setActiveId(first.id);
      },
      { rootMargin: "-10% 0px -60% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  const current = activeId && sections.some((s) => s.id === activeId) ? activeId : sections[0]?.id;
  // A tab with a single section has nothing to navigate, so its content takes the full width.
  const showNav = sections.length > 1;

  return (
    <NavContext.Provider value={register}>
      <div className={cn(showNav && "lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8")}>
        {showNav && (
        <nav aria-label={label} className="hidden lg:block lg:sticky lg:top-6 self-start">
            <ul className="flex flex-col gap-0.5 border-l border-os-container">
              {sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={s.id === current ? "location" : undefined}
                    onClick={() => {
                      setActiveId(s.id);
                      // Scroll only; the URL (and history) stay as they are.
                      document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={cn(
                      "-ml-px w-full border-l-2 px-3 py-1.5 text-left text-sm transition-colors",
                      s.id === current
                        ? "border-os-accent text-foreground font-medium"
                        : "border-transparent text-os-grey hover:text-foreground",
                    )}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
        </nav>
        )}
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
      </div>
    </NavContext.Provider>
  );
}

/** One section of a tab: an anchor the nav can list and scroll to. */
export function NavSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const register = useContext(NavContext);
  useEffect(() => register?.({ id, title }), [register, id, title]);
  return (
    <section id={id} aria-label={title} className="scroll-mt-6">
      {children}
    </section>
  );
}
