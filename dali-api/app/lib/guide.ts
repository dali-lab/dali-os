// Shape of the interactive guide, shared by the guide card (LaunchWelcome) and
// the Help page. Pure data + pure functions: no DOM, no Prisma, no JSX, so both
// the server loader and the client card read one definition of "what the guide
// is" and progress math stays testable.
//
// Step copy and the DOM-targeting bits live in components/guide/steps.tsx,
// keyed by the ids below. Ids are the durable contract — they're what gets
// stored in DALIMember.guideStepIds, so renaming one discards that step's
// progress for everyone. Add and remove freely; rename deliberately.

/** Account state a step can require before the member is allowed past it. */
export type GuideRequirementKey = "photo" | "timezone" | "calendarLink";

/** Which requirements the member currently satisfies. Server-evaluated. */
export type GuideRequirements = Record<GuideRequirementKey, boolean>;

export type GuideChapter = "around" | "setup";

export type GuideStepMeta = {
  id: string;
  chapter: GuideChapter;
  /** Short label for the card eyebrow and the Help page ledger row. */
  title: string;
  /** One line on the Help page ledger, in the imperative. */
  summary: string;
  /**
   * Account state that must be true before this step can be cleared. Required
   * steps have no "I'm there" escape hatch — the member either does the thing
   * or leaves the guide.
   */
  requires?: GuideRequirementKey;
};

export const GUIDE_CHAPTERS: Array<{
  key: GuideChapter;
  title: string;
  blurb: string;
}> = [
  {
    key: "around",
    title: "Find your way around",
    blurb: "The seven places you'll actually use. Each one opens as you go.",
  },
  {
    key: "setup",
    title: "Set up your account",
    blurb:
      "Four things the rest of the lab needs from you — a face, a timezone, a calendar, and how you want to be reached.",
  },
];

// Ordered. The card walks this list top to bottom; the Help page renders it as
// the progress ledger. Role-gated areas (Hiring, Forms, Mentorship, Admin) stay
// out on purpose — a new member has none of them yet.
export const GUIDE_STEPS: GuideStepMeta[] = [
  {
    id: "tasks",
    chapter: "around",
    title: "My Tasks",
    summary: "See everything waiting on you",
  },
  {
    id: "calendar",
    chapter: "around",
    title: "Calendar",
    summary: "Your week, your availability, your hours",
  },
  {
    id: "projects",
    chapter: "around",
    title: "Projects",
    summary: "Where your term's work happens",
  },
  {
    id: "people",
    chapter: "around",
    title: "People",
    summary: "Look up anyone in the lab",
  },
  {
    id: "education",
    chapter: "around",
    title: "Education",
    summary: "Miniseries and workshops you can join",
  },
  {
    id: "documents",
    chapter: "around",
    title: "Documents",
    summary: "Lab-wide docs, notes, and files",
  },
  {
    id: "search",
    chapter: "around",
    title: "Search",
    summary: "Jump anywhere with ⌘K",
  },
  {
    id: "profile",
    chapter: "setup",
    title: "Your profile",
    summary: "Open the page the lab sees",
  },
  {
    id: "profile-photo",
    chapter: "setup",
    title: "Add a photo",
    summary: "So people can put a face to your name",
    requires: "photo",
  },
  {
    id: "timezone",
    chapter: "setup",
    title: "Set your timezone",
    summary: "So meeting times land in your hours",
    requires: "timezone",
  },
  {
    id: "calendar-link",
    chapter: "setup",
    title: "Connect Google Calendar",
    summary: "So the lab can see when you're free",
    requires: "calendarLink",
  },
  {
    id: "notifications",
    chapter: "setup",
    title: "Choose your notifications",
    summary: "Pick what reaches you, and where",
  },
];

export const GUIDE_STEP_IDS: string[] = GUIDE_STEPS.map((s) => s.id);

export const GUIDE_REQUIRED_STEPS: GuideStepMeta[] = GUIDE_STEPS.filter(
  (s) => s.requires,
);

/** True once every requirement a required step depends on is satisfied. */
export function isStepCleared(
  step: GuideStepMeta,
  clearedIds: readonly string[],
  requirements: GuideRequirements,
): boolean {
  // A required step reads its truth from the account, not from the stored list:
  // someone who uploads a photo has done the step whether or not they were in
  // the guide at the time, and someone who removes their photo has undone it.
  if (step.requires) return requirements[step.requires];
  return clearedIds.includes(step.id);
}

export type GuideProgress = {
  cleared: number;
  total: number;
  /** Index of the first unfinished step, or GUIDE_STEPS.length when done. */
  resumeIndex: number;
  complete: boolean;
  /** Required steps the member still owes, in guide order. */
  outstanding: GuideStepMeta[];
};

export function guideProgress(
  clearedIds: readonly string[],
  requirements: GuideRequirements,
  steps: readonly GuideStepMeta[] = GUIDE_STEPS,
): GuideProgress {
  const done = steps.map((s) => isStepCleared(s, clearedIds, requirements));
  const cleared = done.filter(Boolean).length;
  const firstUnfinished = done.indexOf(false);
  return {
    cleared,
    total: steps.length,
    resumeIndex: firstUnfinished === -1 ? steps.length : firstUnfinished,
    complete: cleared === steps.length,
    outstanding: steps.filter(
      (s, i) => Boolean(s.requires) && !done[i],
    ),
  };
}
