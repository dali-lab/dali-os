import { useState } from "react";
import type { Question } from "~/types";
import { Button } from "~/components/ui/Button";
import { findMissingRequired } from "~/lib/form-answers";
import type { FormPage } from "~/lib/form-pages";

// Shared stepping machinery for paginated forms. Surfaces own their own field
// rendering and Submit button; this owns the page index, per-page required
// validation (reusing findMissingRequired), and the Back/step/Next chrome.

export type FormPagerState = {
  index: number;
  pages: FormPage[];
  page: FormPage;
  isFirst: boolean;
  isLast: boolean;
  multi: boolean;
  goBack: () => void;
  // Validate the current page's required questions; advance only when clean.
  // Returns the first missing question (for an inline error) or null.
  goNext: (getValue: (q: Question) => string | undefined) => Question | null;
  reset: () => void;
};

export function useFormPager(
  pages: FormPage[],
  opts?: { excludeFileType?: boolean },
): FormPagerState {
  const excludeFileType = opts?.excludeFileType ?? true;
  const [index, setIndex] = useState(0);
  const clamped = Math.min(index, pages.length - 1);
  const page = pages[clamped];
  return {
    index: clamped,
    pages,
    page,
    isFirst: clamped === 0,
    isLast: clamped === pages.length - 1,
    multi: pages.length > 1,
    goBack: () => setIndex((i) => Math.max(0, i - 1)),
    goNext: (getValue) => {
      const missing = findMissingRequired(page.questions, getValue, {
        excludeFileType,
      });
      if (missing.length > 0) return missing[0];
      setIndex((i) => Math.min(pages.length - 1, i + 1));
      return null;
    },
    reset: () => setIndex(0),
  };
}

// Optional section title/subtitle carried by the page break that starts a page.
export function FormPageHeading({ page }: { page: FormPage }) {
  if (!page.title && !page.subtitle) return null;
  return (
    <div>
      {page.title && (
        <h2 className="font-heading text-lg font-semibold text-dark-blue">
          {page.title}
        </h2>
      )}
      {page.subtitle && (
        <p className="text-sm text-muted-foreground mt-0.5">{page.subtitle}</p>
      )}
    </div>
  );
}

// Back / "Step N of M" / Next footer. On the last page it renders `submitSlot`
// (the caller's own Submit button) instead of Next; pass null for read-only
// surfaces with no submit. Renders nothing for single-page forms — the caller's
// submitSlot is shown on its own in that case.
export function FormPagerNav({
  pager,
  getValue,
  onInvalid,
  onAdvance,
  submitSlot,
  nextLabel = "Next",
}: {
  pager: FormPagerState;
  getValue: (q: Question) => string | undefined;
  onInvalid?: (q: Question) => void;
  onAdvance?: () => void;
  submitSlot?: React.ReactNode;
  nextLabel?: string;
}) {
  if (!pager.multi) return <>{submitSlot}</>;
  const { index, pages, isFirst, isLast, goBack, goNext } = pager;
  return (
    <div className="flex items-center gap-3 pt-2">
      {!isFirst && (
        <Button type="button" variant="secondary" size="sm" onClick={goBack}>
          Back
        </Button>
      )}
      <span className="text-xs text-muted-foreground">
        Step {index + 1} of {pages.length}
      </span>
      <div className="ml-auto">
        {isLast ? (
          submitSlot
        ) : (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              const missing = goNext(getValue);
              if (missing) onInvalid?.(missing);
              else onAdvance?.();
            }}
          >
            {nextLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
