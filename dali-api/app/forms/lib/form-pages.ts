import type { Question } from "~/types";

// A single step of a paginated form: the questions between two page breaks,
// plus the optional heading carried by the break that starts the page.
export type FormPage = {
  title?: string;
  subtitle?: string;
  questions: Question[];
};

export function hasPageBreaks(questions: Question[]): boolean {
  return questions.some((q) => q.type === "pageBreak");
}

// Split a flat question array into ordered pages on `pageBreak` markers. A
// break starts a new page and contributes that page's title/subtitle (its
// `data.label` / `data.description`); the break itself is not a rendered
// question. A break that LEADS the form (before any question) titles the first
// page rather than creating an empty one, so every section — including the
// first — can carry a heading. Always returns at least one page, so callers can
// render uniformly whether or not the form uses breaks.
export function paginateQuestions(questions: Question[]): FormPage[] {
  const pages: FormPage[] = [{ questions: [] }];
  for (const q of questions) {
    if (q.type === "pageBreak") {
      const current = pages[pages.length - 1];
      // Leading break: the first page is still empty and untitled, so adopt the
      // break's heading here instead of pushing a blank page in front of it.
      if (current.questions.length === 0 && !current.title && !current.subtitle) {
        current.title = q.data.label?.trim() || undefined;
        current.subtitle = q.data.description?.trim() || undefined;
        continue;
      }
      pages.push({
        title: q.data.label?.trim() || undefined,
        subtitle: q.data.description?.trim() || undefined,
        questions: [],
      });
      continue;
    }
    pages[pages.length - 1].questions.push(q);
  }
  return pages;
}
