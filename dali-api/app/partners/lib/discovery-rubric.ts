// The lab's partner-evaluation rubric + discovery prompts. One source of truth
// for the Core application-detail eval card. Kept flexible: the scores live in
// PartnerApplication.evalRubric (a JSON blob), so criteria can be reworded here
// without a migration — `criteriaVersion` records which wording produced a
// given saved rubric.

export const EVAL_CRITERIA_VERSION = 1;

export type EvalCriterionKey =
  | "feasibility"
  | "impact"
  | "originality"
  | "learning"
  | "devChallenges"
  | "designChallenges"
  | "partnerTeam"
  | "funding";

export const EVAL_CRITERIA: {
  key: EvalCriterionKey;
  label: string;
  description: string;
}[] = [
  { key: "feasibility", label: "Feasibility", description: "Can DALI realistically build this in a 10-week term structure?" },
  { key: "impact", label: "Potential for impact", description: "Will this meaningfully help a person or group?" },
  { key: "originality", label: "Originality / innovation", description: "Room to innovate — more than a landing-page redesign?" },
  { key: "learning", label: "Learning opportunity", description: "Will students grow and learn something new?" },
  { key: "devChallenges", label: "Dev challenges", description: "Are the engineering problems interesting and appropriate?" },
  { key: "designChallenges", label: "Design challenges", description: "Are the design problems interesting and appropriate?" },
  { key: "partnerTeam", label: "Partner team", description: "Passionate, committed, and qualified partner(s)?" },
  { key: "funding", label: "Funding situation", description: "Do they have funding, or is a grant/Magnuson path realistic?" },
];

// Discovery / first-meeting question prompts — rendered as helper text so the
// evaluator has the script inline (from the lab's partner-meeting template).
export const FIRST_MEETING_PROMPTS: string[] = [
  "In their own words, what do they want from DALI?",
  "What problem are they trying to solve? Who is it for (stakeholders/users)?",
  "What do they have so far — an idea, wireframes, a working product?",
  "What would DALI build — the whole thing, just mobile, which features matter most?",
  "What constraints are we working with — deadlines, funding, technical complexity?",
  "What user research or validation have they done?",
  "What would the dev / design challenge be?",
  "Scope: is this one term or multi-term? What's the ambiguity level?",
];

export type EvalRubric = Partial<Record<EvalCriterionKey, number>> & {
  notes?: string;
  criteriaVersion?: number;
};

// Normalize a stored blob (unknown JSON) into a typed rubric for display.
export function parseEvalRubric(raw: unknown): EvalRubric {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: EvalRubric = {};
  for (const c of EVAL_CRITERIA) {
    const v = obj[c.key];
    if (typeof v === "number" && v >= 1 && v <= 5) out[c.key] = v;
  }
  if (typeof obj.notes === "string") out.notes = obj.notes;
  if (typeof obj.criteriaVersion === "number") out.criteriaVersion = obj.criteriaVersion;
  return out;
}
