import { countRequired, visibleKeys, visibleQuestions } from "~/forms/lib/form-logic";
import type { Question } from "~/types";


export const DOMAIN_COLORS = [
  { border: "border-l-accent-pink", text: "text-accent-pink", bg: "bg-accent-pink", pillText: "text-white", cardBg: "bg-accent-pink/20" },
  { border: "border-l-accent-teal", text: "text-accent-teal", bg: "bg-accent-teal", pillText: "text-white", cardBg: "bg-accent-teal/20" },
  { border: "border-l-accent-yellow", text: "text-os-amber", bg: "bg-accent-yellow", pillText: "text-foreground", cardBg: "bg-accent-yellow/30" },
  { border: "border-l-os-accent", text: "text-os-accent", bg: "bg-os-accent", pillText: "text-white", cardBg: "bg-os-accent/20" },
  { border: "border-l-accent-green", text: "text-os-green", bg: "bg-accent-green", pillText: "text-foreground", cardBg: "bg-accent-green/30" },
];

export function getDomainColor(index: number) {
  return DOMAIN_COLORS[index % DOMAIN_COLORS.length];
}

// "Nov 13" — for the domain pill's secondary close-date label and its tooltip.
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export type DomainColor = ReturnType<typeof getDomainColor>;

export type Section = {
  id: string;
  label: string;
  color?: DomainColor;
  requiredCount: number;
  answeredRequiredCount: number;
};

export type DomainShape = {
  id: string;
  name: string;
  closeDate?: string | null;
  closed?: boolean;
  challenges: { challengeVersionId: string; challengeName: string; description: any; questions: Question[] }[];
};

export function getPickedQuestions(
  domain: DomainShape,
  pickedCvId: string | null | undefined,
): Question[] {
  if (!pickedCvId) return [];
  const picked = domain.challenges.find(c => c.challengeVersionId === pickedCvId);
  return picked?.questions ?? [];
}

// Required continued interest questions per domain reusing a waitlisted
// application: how many there are and how many are answered.
export type ContinuedProgress = Record<string, { required: number; answered: number }>;

// The general form is one form split around the domains step, so a rule may
// point across the split: visibility is settled on the whole list, then divided.
export function visibleGeneralParts(formQuestions: Question[], answers: Record<string, string>) {
  const visible = visibleKeys(formQuestions, answers);
  const shown = formQuestions.filter(q => visible.has(q.key));
  return {
    before: shown.filter(q => !q.data.afterDomains),
    after: shown.filter(q => q.data.afterDomains),
  };
}

export function computeRequiredProgress(
  formQuestions: Question[],
  domains: DomainShape[],
  selectedDomainIds: string[],
  pickedChallengeByDomain: Record<string, string>,
  answers: Record<string, string>,
  domainAnswers: Record<string, Record<string, string>>,
  continuedProgress: ContinuedProgress,
  closedDomainIds: Set<string>,
  generalFrozen: boolean,
) {
  let totalRequired = 0;
  let totalAnswered = 0;

  if (!generalFrozen) {
    const { before, after } = visibleGeneralParts(formQuestions, answers);
    const general = countRequired([...before, ...after], answers);
    totalRequired += general.required;
    totalAnswered += general.answered;
  }

  for (const domainId of selectedDomainIds) {
    if (closedDomainIds.has(domainId)) continue;
    const domain = domains.find(d => d.id === domainId);
    if (!domain) continue;
    const questions = visibleQuestions(
      getPickedQuestions(domain, pickedChallengeByDomain[domainId]),
      domainAnswers[domainId] ?? {},
    );
    const counted = countRequired(questions, domainAnswers[domainId]);
    totalRequired += counted.required;
    totalAnswered += counted.answered;
    totalRequired += continuedProgress[domainId]?.required ?? 0;
    totalAnswered += continuedProgress[domainId]?.answered ?? 0;
  }

  return { totalRequired, totalAnswered };
}

export function buildSections(
  formQuestions: Question[],
  domains: DomainShape[],
  selectedDomainIds: string[],
  pickedChallengeByDomain: Record<string, string>,
  answers: Record<string, string>,
  domainAnswers: Record<string, Record<string, string>>,
  continuedProgress: ContinuedProgress,
  closedDomainIds: Set<string>,
  generalFrozen: boolean,
): Section[] {
  const sections: Section[] = [];
  const { before: beforeQuestions, after: afterQuestions } = visibleGeneralParts(
    formQuestions,
    answers,
  );

  if (beforeQuestions.length > 0) {
    const counted = generalFrozen
      ? { required: 0, answered: 0 }
      : countRequired(beforeQuestions, answers);
    sections.push({
      id: "general-before",
      label: "General",
      requiredCount: counted.required,
      answeredRequiredCount: counted.answered,
    });
  }

  for (const domainId of selectedDomainIds) {
    const idx = domains.findIndex(d => d.id === domainId);
    if (idx < 0) continue;
    const domain = domains[idx];
    if (domain.challenges.length === 0) continue;
    const frozen = closedDomainIds.has(domainId);
    const questions = visibleQuestions(
      getPickedQuestions(domain, pickedChallengeByDomain[domainId]),
      domainAnswers[domainId] ?? {},
    );
    const counted = frozen
      ? { required: 0, answered: 0 }
      : countRequired(questions, domainAnswers[domainId]);
    sections.push({
      id: `domain-${domainId}`,
      label: domain.name,
      color: getDomainColor(idx),
      requiredCount: counted.required + (frozen ? 0 : continuedProgress[domainId]?.required ?? 0),
      answeredRequiredCount:
        counted.answered + (frozen ? 0 : continuedProgress[domainId]?.answered ?? 0),
    });
  }

  if (afterQuestions.length > 0) {
    const counted = generalFrozen
      ? { required: 0, answered: 0 }
      : countRequired(afterQuestions, answers);
    sections.push({
      id: "general-after",
      label: "Anything Else",
      requiredCount: counted.required,
      answeredRequiredCount: counted.answered,
    });
  }

  return sections;
}
