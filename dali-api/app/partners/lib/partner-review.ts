// Internal partner-application review vocabulary: the reviewer eval rubric,
// the accept checklist, and the first-meeting note template. One source of
// truth for the Core detail page + its action. Partners never see any of this.

// The canonical reviewer rubric — DALI's 8-point reading criteria. (The public
// site shows a 5-point framing; this is the granular set reviewers fill in.)
export const EVAL_CRITERIA = [
  { key: "feasibility", label: "Feasibility" },
  { key: "impact", label: "Potential for impact" },
  { key: "originality", label: "Originality / room for innovation" },
  { key: "learning", label: "Learning opportunity for students" },
  { key: "devChallenges", label: "Type of dev challenges" },
  { key: "designChallenges", label: "Type of design challenges" },
  { key: "team", label: "Passionate, committed, qualified team" },
  { key: "funding", label: "Funding situation" },
] as const;

export type EvalCriterionKey = (typeof EVAL_CRITERIA)[number]["key"];

export const RECOMMENDATION_OPTIONS = [
  "Undecided",
  "Meet with them",
  "Lean yes",
  "Lean no",
  "Reject",
] as const;
export type Recommendation = (typeof RECOMMENDATION_OPTIONS)[number];

export const AMBIGUITY_OPTIONS = ["Low", "Medium", "High"] as const;
export type Ambiguity = (typeof AMBIGUITY_OPTIONS)[number];

export type PartnerEvaluation = {
  criteria: Partial<Record<EvalCriterionKey, string>>;
  concerns: string;
  shouldMeet: boolean;
  recommendation: Recommendation;
  ambiguityRating: Ambiguity | "";
};

export function emptyEvaluation(): PartnerEvaluation {
  return {
    criteria: {},
    concerns: "",
    shouldMeet: false,
    recommendation: "Undecided",
    ambiguityRating: "",
  };
}

// Tolerant parse of the JSON blob on PartnerApplication.evaluation.
export function parseEvaluation(raw: unknown): PartnerEvaluation {
  const base = emptyEvaluation();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const criteria: Partial<Record<EvalCriterionKey, string>> = {};
  if (o.criteria && typeof o.criteria === "object") {
    for (const c of EVAL_CRITERIA) {
      const v = (o.criteria as Record<string, unknown>)[c.key];
      if (typeof v === "string" && v.trim()) criteria[c.key] = v;
    }
  }
  return {
    criteria,
    concerns: typeof o.concerns === "string" ? o.concerns : "",
    shouldMeet: o.shouldMeet === true,
    recommendation: (RECOMMENDATION_OPTIONS as readonly string[]).includes(
      o.recommendation as string,
    )
      ? (o.recommendation as Recommendation)
      : "Undecided",
    ambiguityRating: (AMBIGUITY_OPTIONS as readonly string[]).includes(
      o.ambiguityRating as string,
    )
      ? (o.ambiguityRating as Ambiguity)
      : "",
  };
}

// True when a reviewer has actually put something in the eval (drives the
// read-mode "not yet evaluated" empty state).
export function evaluationHasContent(e: PartnerEvaluation): boolean {
  return (
    Object.keys(e.criteria).length > 0 ||
    e.concerns.trim() !== "" ||
    e.shouldMeet ||
    e.recommendation !== "Undecided" ||
    e.ambiguityRating !== ""
  );
}

// The accept checklist from the partner-lead process.
export const ACCEPT_CHECKLIST_TEMPLATE = [
  { key: "term", label: "Decide which term" },
  { key: "ambiguity", label: "Decide ambiguity rating" },
  { key: "sow", label: "Write a Scope of Work" },
  { key: "funding", label: "Decide funding model, start paperwork if needed" },
  { key: "selection", label: "Write Project Selection page" },
  { key: "kickoff", label: "Introduce team to partner, invite to kickoff" },
  { key: "transfer", label: "Transfer knowledge + material to team drive" },
] as const;

export type ChecklistItem = { key: string; label: string; done: boolean };

// Merge stored done-state onto the template so new template items appear and
// removed ones drop, without a migration.
export function resolveChecklist(raw: unknown): ChecklistItem[] {
  const doneByKey = new Map<string, boolean>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object") {
        const k = (item as Record<string, unknown>).key;
        const d = (item as Record<string, unknown>).done;
        if (typeof k === "string") doneByKey.set(k, d === true);
      }
    }
  }
  return ACCEPT_CHECKLIST_TEMPLATE.map((t) => ({
    key: t.key,
    label: t.label,
    done: doneByKey.get(t.key) ?? false,
  }));
}

// Pre-fills a new "meeting" note. Guides the first partner conversation
// (partner-lead first-meeting template).
export const FIRST_MEETING_TEMPLATE = `First meeting — [date], [who attended]

Their story / motivation:

Problem & who it's for:

Scope & what they imagine we'd build:

Funding situation:

Their availability / commitment:

Open questions & concerns:

Next steps:`;

// Note body is stored as { text }. Small, plain-text log entries — not a
// collab doc (the SOW covers rich co-editing).
export function noteText(body: unknown): string {
  if (body && typeof body === "object") {
    const t = (body as Record<string, unknown>).text;
    if (typeof t === "string") return t;
  }
  return "";
}
