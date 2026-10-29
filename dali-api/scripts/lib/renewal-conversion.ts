// Pure planning for scripts/convert-renewal-applications.ts: what a legacy
// "Renew: X" PartnerApplication becomes now that renewal decisions live on
// ProjectTermStatus.

export type RenewalStage = "Backlog" | "New" | "Interview" | "Deciding" | "Accepted" | "Rejected";

export type TermRef = { id: string; code: string; sortKey: number; startDate: Date };

export type RenewalApp = {
  id: string;
  title: string;
  stage: RenewalStage;
  rejectReason: string | null;
  feeCents: number | null;
  createdAt: Date;
};

export type RenewalAction =
  | { kind: "decide"; termId: string; termCode: string; isContinuing: boolean; reason: string | null; feeCents: number | null }
  | { kind: "close" }
  | { kind: "skip"; why: string };

const REASON_LABELS: Record<string, string> = {
  NotAFit: "Not a fit",
  NoCapacity: "No capacity",
  Funding: "Funding",
  Timing: "Timing",
  Withdrawn: "Withdrawn",
  Other: "Other",
};

/** The term the renewal was deciding: the first term after the latest one the
 *  project had started when the renewal application was created. */
export function decisionTermFor(projectTerms: TermRef[], allTerms: TermRef[], createdAt: Date): TermRef | null {
  const started = projectTerms.filter((t) => t.startDate <= createdAt);
  if (started.length === 0) return null;
  const current = started.reduce((a, b) => (b.sortKey > a.sortKey ? b : a));
  const later = allTerms.filter((t) => t.sortKey > current.sortKey);
  if (later.length === 0) return null;
  return later.reduce((a, b) => (b.sortKey < a.sortKey ? b : a));
}

export function planRenewalConversion(input: {
  app: RenewalApp;
  projectId: string | null;
  decisionTerm: TermRef | null;
  existingDecision: boolean;
}): RenewalAction {
  const { app, projectId, decisionTerm, existingDecision } = input;
  const decided = app.stage === "Accepted" || app.stage === "Rejected";
  if (!decided) return { kind: "close" };
  if (!projectId) return { kind: "skip", why: "no linked project" };
  if (!decisionTerm) return { kind: "skip", why: "no next term to decide" };
  if (existingDecision) return { kind: "skip", why: `already decided for ${decisionTerm.code}` };
  const isContinuing = app.stage === "Accepted";
  return {
    kind: "decide",
    termId: decisionTerm.id,
    termCode: decisionTerm.code,
    isContinuing,
    reason: isContinuing ? null : app.rejectReason ? (REASON_LABELS[app.rejectReason] ?? app.rejectReason) : null,
    feeCents: isContinuing ? app.feeCents : null,
  };
}
