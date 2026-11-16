export const WARNING_REASONS = [
  { value: "missed_meeting", label: "Missed mentorship meeting" },
  { value: "missed_lab", label: "Missed lab" },
  { value: "other", label: "Other" },
] as const;
export type WarningReason = (typeof WARNING_REASONS)[number]["value"];

export const WARNING_STATUSES = ["open", "resolved"] as const;
export type WarningStatus = (typeof WARNING_STATUSES)[number];

export function reasonLabel(value: string): string {
  return WARNING_REASONS.find((r) => r.value === value)?.label ?? value;
}

export type WarningInput = {
  memberId: string;
  reason: WarningReason;
  notes: string;
  occurredOn: string;
};

/** Returns an error message, or null when the input is acceptable. "Other"
 *  needs notes; everything else is optional. */
export function validateWarning(i: Partial<WarningInput>): string | null {
  if (!i.memberId) return "Pick a member.";
  if (!WARNING_REASONS.some((r) => r.value === i.reason)) return "Pick a reason.";
  if (!i.occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(i.occurredOn)) return "Pick a date.";
  if (i.reason === "other" && !(i.notes ?? "").trim()) return "Add notes when the reason is Other.";
  return null;
}

export const WARNING_STAGES = [
  { value: "pending", label: "Pending" },
  { value: "pre_meeting_1", label: "Pre meeting 1" },
  { value: "pre_meeting_2", label: "Pre meeting 2" },
  { value: "ok_to_reapp", label: "Ok to reapp" },
  { value: "dropped", label: "Dropped from lab" },
] as const;
export type WarningStage = (typeof WARNING_STAGES)[number]["value"];

export function stageLabel(value: string): string {
  return WARNING_STAGES.find((s) => s.value === value)?.label ?? value;
}

export type WarningCaseInput = {
  investigatorId: string;
  linkUrl: string;
  willAcceptReapp: "" | "yes" | "no";
  stage: WarningStage;
  meeting1On: string;
  meeting1Notes: string;
  meeting2On: string;
  meeting2Notes: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateWarningCase(i: Partial<WarningCaseInput>): string | null {
  if (i.stage !== undefined && !WARNING_STAGES.some((s) => s.value === i.stage)) return "Pick a status.";
  if (i.willAcceptReapp && i.willAcceptReapp !== "yes" && i.willAcceptReapp !== "no") {
    return "Pick yes or no for reapplying.";
  }
  if (i.linkUrl && !/^https?:\/\/\S+$/i.test(i.linkUrl.trim())) return "Enter a full link starting with http.";
  for (const d of [i.meeting1On, i.meeting2On]) {
    if (d && !ISO_DATE.test(d)) return "Pick a valid meeting date.";
  }
  return null;
}
