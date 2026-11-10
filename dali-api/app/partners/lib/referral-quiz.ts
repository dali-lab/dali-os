// Client-safe quiz content for the one-time partner-referral quiz. Shown at
// /refer before a member can submit a referral. Short, scenario-based, and
// every wrong answer carries a one-line explanation so the quiz teaches rather
// than just gates.
//
// Grading model: must get every question right to pass. On a wrong answer the
// form keeps every other answer the member picked and highlights the ones
// that were wrong, so a retry is one or two taps, not a reset.

export type QuizChoice = {
  id: string;
  label: string;
  // Shown only when the member selects a wrong answer, so correct selections
  // don't spoil the lesson for a future retake.
  explanation?: string;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  // Short framing above the choices (e.g. a scenario).
  context?: string;
  choices: QuizChoice[];
  correctChoiceId: string;
};

export const REFERRAL_QUIZ: QuizQuestion[] = [
  {
    id: "tier-cold",
    prompt: "Which tier is this?",
    context:
      "A family friend runs a nonprofit. They haven't heard of DALI. You have no specific project idea for them — just the opportunity. You want to pass their name along.",
    choices: [
      { id: "a", label: "Cold referral" },
      {
        id: "b",
        label: "Warm referral",
        explanation:
          "Warm means they're already filling out the partner application themselves. This one isn't — you're passing along a lead.",
      },
      {
        id: "c",
        label: "Full pitch",
        explanation:
          "Full pitch means you've pitched a specific idea to them and they're on board. You don't have an idea here.",
      },
    ],
    correctChoiceId: "a",
  },
  {
    id: "tier-warm",
    prompt: "Which tier is this?",
    context:
      "A professor you know has a research project they want built. They're excited, they already asked how to apply, and they're going to submit the partner application themselves.",
    choices: [
      {
        id: "a",
        label: "Cold referral",
        explanation:
          "Cold means you're handing Core a lead to reach out to. Here the partner is already applying — further along than Cold.",
      },
      { id: "b", label: "Warm referral" },
      {
        id: "c",
        label: "Full pitch",
        explanation:
          "Full pitch means YOU pitched the project idea. Your professor came to you with theirs.",
      },
    ],
    correctChoiceId: "b",
  },
  {
    id: "tier-full-pitch",
    prompt: "Which tier is this?",
    context:
      "You had an idea for a website a local museum should have. You emailed them, pitched it, and they're interested. You want them to apply through DALI.",
    choices: [
      {
        id: "a",
        label: "Cold referral",
        explanation:
          "Cold is for leads you haven't pitched yet. You already pitched this one.",
      },
      {
        id: "b",
        label: "Warm referral",
        explanation:
          "Warm is when the partner comes with their own project idea and just needs the application. Here the idea is yours.",
      },
      { id: "c", label: "Full pitch" },
    ],
    correctChoiceId: "c",
  },
  {
    id: "representing-the-lab",
    prompt:
      "You're about to cold-email someone pitching DALI building their startup an app. You aren't sure how it'll land. What's the right move?",
    choices: [
      {
        id: "a",
        label: "Send it — worst case they ignore it.",
        explanation:
          "When you reach out, you're representing DALI. A cold pitch that misses can burn a real relationship the lab hasn't built yet.",
      },
      { id: "b", label: "Ask Partner Relations first." },
      {
        id: "c",
        label: "Skip it — they're probably too busy.",
        explanation:
          "Skipping is fine, but the better move is to check with Partner Relations. They may already know the person or want to coordinate.",
      },
    ],
    correctChoiceId: "b",
  },
  {
    id: "payout-timing",
    prompt: "When does the referral bounty get paid?",
    choices: [
      {
        id: "a",
        label: "When I submit the referral.",
        explanation:
          "Submitting a referral starts the process. The bounty only applies when the partner actually signs on.",
      },
      {
        id: "b",
        label: "When the partner signs the SOW and becomes a DALI partner.",
      },
      {
        id: "c",
        label: "When the project ships.",
        explanation:
          "The bounty is for bringing a partner in, not for project delivery.",
      },
    ],
    correctChoiceId: "b",
  },
];

export const REFERRAL_QUIZ_QUESTION_IDS = REFERRAL_QUIZ.map((q) => q.id);

/** Grades a map of questionId → chosenChoiceId. Returns the wrong question ids. */
export function gradeReferralQuiz(
  answers: Record<string, string>,
): { passed: boolean; wrongQuestionIds: string[] } {
  const wrong: string[] = [];
  for (const q of REFERRAL_QUIZ) {
    if (answers[q.id] !== q.correctChoiceId) wrong.push(q.id);
  }
  return { passed: wrong.length === 0, wrongQuestionIds: wrong };
}

export const REFERRAL_TIER_LABEL: Record<"Cold" | "Warm" | "FullPitch", string> = {
  Cold: "Cold referral",
  Warm: "Warm referral",
  FullPitch: "Full pitch",
};

export const REFERRAL_TIER_PAYOUT_USD: Record<"Cold" | "Warm" | "FullPitch", number> = {
  Cold: 100,
  Warm: 250,
  FullPitch: 500,
};

export const REFERRAL_TIER_BLURB: Record<"Cold" | "Warm" | "FullPitch", string> = {
  Cold:
    "You know of a person or organization that could be a partner. You pass the contact on and Core takes it from there.",
  Warm:
    "A person or organization you know is ready to apply to DALI themselves. You give Core their details and let them know to apply at /partner/apply.",
  FullPitch:
    "You pitched a specific project idea to a partner and they're on board to fund it through DALI. You help Core cross-check that they've applied.",
};
