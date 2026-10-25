import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Check, FlaskConical, ListChecks } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { buttonClasses } from "~/components/ui/Button";
import { LESSON_FEATURES } from "~/journeys/lib/doc-features";
import { hasLab, richDocIsEmpty } from "~/journeys/lib/journey";
import type { JourneyModule } from "~/journeys/lib/types";

export function LessonView({
  module: mod,
  backHref,
  pageIndex,
  isCompleted,
  completing,
  onPageChange,
  onOpenLab,
  onOpenQuiz,
  onComplete,
}: {
  module: JourneyModule;
  backHref: string;
  pageIndex: number;
  isCompleted: boolean;
  completing: boolean;
  onPageChange: (index: number) => void;
  onOpenLab: () => void;
  onOpenQuiz: () => void;
  onComplete: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const page = mod.pages[pageIndex];
  const isLast = pageIndex === mod.pages.length - 1;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pageIndex]);

  let finalAction;
  if (hasLab(mod)) {
    finalAction = (
      <button type="button" onClick={onOpenLab} className={buttonClasses("primary", "md")}>
        <FlaskConical className="h-4 w-4" aria-hidden />
        Open the lab
      </button>
    );
  } else if (mod.quiz) {
    finalAction = (
      <button type="button" onClick={onOpenQuiz} className={buttonClasses("primary", "md")}>
        <ListChecks className="h-4 w-4" aria-hidden />
        Take the quiz
      </button>
    );
  } else if (!isCompleted) {
    finalAction = (
      <button type="button" onClick={onComplete} disabled={completing} className={buttonClasses("primary", "md")}>
        <Check className="h-4 w-4" aria-hidden />
        Mark module complete
      </button>
    );
  } else {
    finalAction = (
      <Link to={backHref} className={buttonClasses("secondary", "md")}>
        Back to journey
      </Link>
    );
  }

  if (!page) return <p className="p-6 text-os-grey">This module doesn't have any pages yet.</p>;

  return (
    <div ref={scrollRef} className="min-h-0 overflow-y-auto">
      <article className="max-w-3xl px-1 py-2 lg:px-10 lg:py-6">
        <p className="text-sm tabular-nums text-os-muted">
          Page {pageIndex + 1} of {mod.pages.length}
        </p>
        <h2 className="mt-2 font-heading text-3xl font-semibold">{page.title}</h2>
        <div className="mt-8">
          {richDocIsEmpty(page.content) ? (
            <p className="text-os-muted">This page doesn't have any content yet.</p>
          ) : (
            <DocEditor key={page.id} editable={false} features={LESSON_FEATURES} initialContent={page.content} />
          )}
        </div>
        <footer className="mt-14 flex items-center justify-between gap-4 border-t border-os-container pt-6">
          {pageIndex > 0 ? (
            <button type="button" onClick={() => onPageChange(pageIndex - 1)} className={buttonClasses("ghost", "md")}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Previous
            </button>
          ) : (
            <span />
          )}
          {isLast ? (
            finalAction
          ) : (
            <button type="button" onClick={() => onPageChange(pageIndex + 1)} className={buttonClasses("secondary", "md")}>
              Next page
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </footer>
      </article>
    </div>
  );
}
