export type ReferralStatus = "Sent" | "DaliCalled" | "Applied" | "Project";

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  Sent: "Sent",
  DaliCalled: "DALI called",
  Applied: "Applied",
  Project: "Now a project",
};

export function referralStatus(input: {
  reachedOutAt: Date | string | null;
  partnerApplicationId: string | null;
  resultingProjectId: string | null;
}): ReferralStatus {
  if (input.partnerApplicationId && input.resultingProjectId) return "Project";
  if (input.partnerApplicationId) return "Applied";
  if (input.reachedOutAt) return "DaliCalled";
  return "Sent";
}
