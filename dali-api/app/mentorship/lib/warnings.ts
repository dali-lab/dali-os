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
