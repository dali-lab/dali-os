import type { JourneyContent } from "./types";
import { ENTRY_FILE } from "./file-tree";
import { slideIssues } from "~/components/slides/slide-edit";
import { studioIssues } from "./studio";

export interface JourneyIssue {
  moduleId: string | null;
  message: string;
}

/** Everything that blocks publishing. An empty list means the draft can go live. */
export function validateJourney(journey: JourneyContent): JourneyIssue[] {
  const issues: JourneyIssue[] = [];
  if (!journey.title.trim()) issues.push({ moduleId: null, message: "The journey needs a title." });
  if (journey.modules.length === 0) issues.push({ moduleId: null, message: "The journey has no modules." });
  for (const m of journey.modules) {
    const name = m.title.trim() || "Untitled module";
    const add = (message: string) => issues.push({ moduleId: m.id, message });
    if (!m.title.trim()) add("A module is missing a title.");
    if (m.pages.length === 0) add(`${name} needs at least one page.`);
    m.pages.forEach((p, i) => {
      if (!p.title.trim()) add(`${name}: page ${i + 1} is missing a title.`);
    });
    if (m.lab) {
      if (!(ENTRY_FILE in m.lab.files)) add(`${name}: the lab needs an ${ENTRY_FILE} file.`);
      if (m.lab.steps.length === 0) add(`${name}: the lab needs at least one step.`);
      m.lab.steps.forEach((s, i) => {
        if (!s.check.trim()) add(`${name}: lab step ${i + 1} has no check.`);
      });
    }
    if (m.lab && m.studio) add(`${name} has two labs. Remove one.`);
    if (m.studio) for (const issue of studioIssues(m.studio)) add(`${name}: ${issue}`);
    for (const issue of slideIssues(m.slides ?? [])) add(`${name}: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}`);
    if (m.quiz) {
      if (m.quiz.questions.length === 0) add(`${name}: the quiz needs at least one question.`);
      m.quiz.questions.forEach((q, i) => {
        const label = `${name}: quiz question ${i + 1}`;
        if (!q.prompt.trim()) add(`${label} has no prompt.`);
        if (q.type === "multiple-choice") {
          if (q.options.length < 2) add(`${label} needs at least two options.`);
          if (q.options.some((o) => !o.text.trim())) add(`${label} has an empty option.`);
          if (!q.options.some((o) => o.id === q.correctOptionId)) add(`${label} has no correct answer selected.`);
        }
      });
    }
  }
  return issues;
}
