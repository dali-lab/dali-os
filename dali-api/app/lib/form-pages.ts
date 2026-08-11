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
// question. Content before the first break is page 1 (untitled). Always
// returns at least one page, so callers can render uniformly whether or not
// the form uses breaks.
export function paginateQuestions(questions: Question[]): FormPage[] {
  const pages: FormPage[] = [{ questions: [] }];
  for (const q of questions) {
    if (q.type === "pageBreak") {
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
