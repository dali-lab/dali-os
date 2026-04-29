import type { DecisionStage, DecisionType } from "~/types";

// Append-only Decision rows mean "current decision per type" is just the row at
// the highest stage reached for that type. Stage rank: Released > Final > Draft.
const STAGE_RANK: Record<DecisionStage, number> = {
  Draft: 0,
  Final: 1,
  Released: 2,
};

export type DecisionPill = {
  type: DecisionType;
  stage: DecisionStage;
  waitlistRank: number | null;
  createdAt: Date;
};

type DecisionRow = {
  type: DecisionType;
  stage: DecisionStage;
  waitlistRank?: number | null;
  createdAt: Date | string;
};

type SummarizeInput = {
  decisions: DecisionRow[];
};

// Returns one pill per DecisionType present on the DomainApplication, each at
// the highest stage that type has reached. Pills are ordered by the chosen
// row's createdAt (oldest first) so the timeline reads left-to-right.
export function summarizeDecisionPills(da: SummarizeInput): DecisionPill[] {
  const byType = new Map<DecisionType, DecisionRow>();
  for (const row of da.decisions) {
    const current = byType.get(row.type);
    if (!current) {
      byType.set(row.type, row);
      continue;
    }
    const rowRank = STAGE_RANK[row.stage];
    const currentRank = STAGE_RANK[current.stage];
    if (rowRank > currentRank) {
      byType.set(row.type, row);
    } else if (rowRank === currentRank) {
      // Tie on stage → keep the newer row.
      if (toDate(row.createdAt) > toDate(current.createdAt)) {
        byType.set(row.type, row);
      }
    }
  }

  return Array.from(byType.values())
    .map((row): DecisionPill => ({
      type: row.type,
      stage: row.stage,
      waitlistRank: row.waitlistRank ?? null,
      createdAt: toDate(row.createdAt),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export type PrePipelinePill = "Reviewing" | "InterviewScheduled" | "PostInterview";

type PrePipelineInput = {
  application: { statusUpdates: Array<{ newStatus: string }> };
  interviews: Array<{ status: string }>;
  decisions: unknown[];
};

// Pre-decision pill synthesized from interview/review state. Only meaningful
// when `summarizeDecisionPills` returns empty — callers are responsible for
// that gate.
export function synthesizePrePipelinePill(
  da: PrePipelineInput,
): PrePipelinePill | null {
  if (da.decisions.length > 0) return null;

  if (da.interviews.some((i) => i.status === "Scheduled")) {
    return "InterviewScheduled";
  }
  if (da.interviews.some((i) => i.status === "Completed")) {
    return "PostInterview";
  }

  const hasSubmitted = da.application.statusUpdates.some(
    (u) => u.newStatus === "Submitted",
  );
  if (hasSubmitted) return "Reviewing";

  return null;
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}
