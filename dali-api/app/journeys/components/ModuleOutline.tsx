import { CheckCircle2, FlaskConical, ListChecks, Presentation, type LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { getLabInfo } from "~/journeys/lib/journey";
import type { JourneyModule } from "~/journeys/lib/types";

export type ModuleView = "lesson" | "slides" | "lab" | "quiz";

const rowClass = (active: boolean) =>
  cn(
    "flex w-full items-start gap-3 rounded-os-item px-3 py-2.5 text-left text-sm transition-colors",
    active ? "bg-os-card text-foreground" : "text-os-grey hover:text-foreground",
  );

export function ModuleOutline({
  module: mod,
  view,
  pageIndex,
  labDone,
  quizDone,
  onSelectPage,
  onOpen,
}: {
  module: JourneyModule;
  view: ModuleView;
  pageIndex: number;
  labDone: boolean;
  quizDone: boolean;
  onSelectPage: (index: number) => void;
  onOpen: (view: Exclude<ModuleView, "lesson">) => void;
}) {
  const slideCount = mod.slides?.length ?? 0;
  const activities: { id: "lab" | "quiz"; icon: LucideIcon; title: string; meta: string; done: boolean }[] = [];
  const lab = getLabInfo(mod);
  if (lab) activities.push({ id: "lab", icon: FlaskConical, title: `Lab: ${lab.title}`, meta: lab.meta, done: labDone });
  if (mod.quiz) {
    const n = mod.quiz.questions.length;
    activities.push({ id: "quiz", icon: ListChecks, title: `Quiz: ${mod.quiz.title}`, meta: `${n} ${n === 1 ? "question" : "questions"}`, done: quizDone });
  }

  return (
    <nav aria-label="Module contents" className="border-b border-os-container pb-4 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
      <p className="px-3 text-xs font-medium text-os-muted">
        Lesson · {mod.pages.length} {mod.pages.length === 1 ? "page" : "pages"}
      </p>
      <ol className="mt-3 space-y-1">
        {mod.pages.map((p, i) => {
          const active = view === "lesson" && i === pageIndex;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onSelectPage(i)} aria-current={active ? "page" : undefined} className={rowClass(active)}>
                <span className="w-4 shrink-0 tabular-nums text-os-muted">{i + 1}</span>
                {p.title}
              </button>
            </li>
          );
        })}
      </ol>

      {slideCount > 0 && (
        <button
          type="button"
          onClick={() => onOpen("slides")}
          aria-current={view === "slides" ? "page" : undefined}
          className={cn(rowClass(view === "slides"), "mt-1")}
        >
          <Presentation className="mt-0.5 h-4 w-4 shrink-0 text-os-muted" aria-hidden />
          <span>
            Slides
            <span className="mt-0.5 block text-xs text-os-muted">
              {slideCount} {slideCount === 1 ? "slide" : "slides"}
            </span>
          </span>
        </button>
      )}

      {activities.length > 0 && (
        <div className="mt-4 border-t border-os-container pt-4">
          <p className="px-3 text-xs font-medium text-os-muted">Practice</p>
          <ul className="mt-2 space-y-1">
            {activities.map(({ id, icon: Icon, title, meta, done }) => (
              <li key={id}>
                <button type="button" onClick={() => onOpen(id)} aria-current={view === id ? "page" : undefined} className={rowClass(view === id)}>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-os-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {title}
                    <span className="mt-0.5 block text-xs text-os-muted">{meta}</span>
                  </span>
                  {done && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-os-green" aria-label="Done" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
