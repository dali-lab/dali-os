import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";

// A response that feeds another feature can't be deleted or edited: those
// relations are SetNull, so a delete would silently detach a live application,
// and staffing rows would outlive their source.
export const RESPONSE_LOCK_SELECT = {
  slot: true,
  staffingCycleId: true,
  educationOfferingId: true,
  educationSessionId: true,
  partnerApplication: { select: { id: true } },
  educationApplication: { select: { id: true } },
  partnerSurveyFor: { select: { id: true } },
} as const;

export type ResponseLockFields = {
  slot: string | null;
  staffingCycleId: string | null;
  educationOfferingId: string | null;
  educationSessionId: string | null;
  partnerApplication: unknown | null;
  educationApplication: unknown | null;
  partnerSurveyFor: unknown | null;
};

export const RESPONSE_LOCKED_BOUND = "Part of a staffing or education record.";
export const RESPONSE_LOCKED_APPLICATION = "Linked to an application or survey.";
export const RESPONSE_LOCKED_PROFILE = "Part of the onboarding profile.";

/** Why this response must stay as it is, or null when it can be deleted or
 *  edited. The one rule shared by the delete action, the edit endpoint and the
 *  results UI. */
export function responseLockReason(
  submission: ResponseLockFields,
  formName: string,
): string | null {
  if (formName === NEW_MEMBER_PROFILE_FORM_NAME) return RESPONSE_LOCKED_PROFILE;
  if (
    submission.slot ||
    submission.staffingCycleId ||
    submission.educationOfferingId ||
    submission.educationSessionId
  ) {
    return RESPONSE_LOCKED_BOUND;
  }
  if (
    submission.partnerApplication ||
    submission.educationApplication ||
    submission.partnerSurveyFor
  ) {
    return RESPONSE_LOCKED_APPLICATION;
  }
  return null;
}
