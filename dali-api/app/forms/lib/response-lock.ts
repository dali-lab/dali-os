export const RESPONSE_LOCK_SELECT = {
  slot: true,
  staffingCycleId: true,
  educationOfferingId: true,
  educationSessionId: true,
  partnerApplication: { select: { id: true, title: true, resultingProjectId: true } },
  educationApplication: {
    select: {
      id: true,
      status: true,
      offering: { select: { title: true } },
      _count: { select: { attendances: true } },
    },
  },
  partnerSurveyFor: { select: { id: true } },
} as const;

export type ResponseLockFields = {
  slot: string | null;
  staffingCycleId: string | null;
  educationOfferingId: string | null;
  educationSessionId: string | null;
  partnerApplication: { id: string; title: string; resultingProjectId: string | null } | null;
  educationApplication: {
    id: string;
    status: string;
    offering: { title: string };
    _count: { attendances: number };
  } | null;
  partnerSurveyFor: { id: string } | null;
};

export const RESPONSE_LOCKED_BOUND = "Part of a staffing or education record.";
export const RESPONSE_LOCKED_APPLICATION = "Linked to an application or survey.";

/** Why the respondent can't edit this response, or null when they can. */
export function responseLockReason(submission: ResponseLockFields): string | null {
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

export type ResponseDeletePlan =
  | { blocked: string }
  | { blocked: null; effects: string[] };

/** What an owner delete also does, or why it's refused. The one rule shared by
 *  the delete action and the results UI. */
export function responseDeletePlan(submission: ResponseLockFields): ResponseDeletePlan {
  const partnerApp = submission.partnerApplication;
  const eduApp = submission.educationApplication;
  if (partnerApp?.resultingProjectId) {
    return { blocked: "Its partner application became a project." };
  }
  if (eduApp && (eduApp.status === "Approved" || eduApp.status === "Waitlisted")) {
    return {
      blocked: `Its application to ${eduApp.offering.title} is ${eduApp.status.toLowerCase()}. Reject or withdraw it first.`,
    };
  }
  if (eduApp && eduApp._count.attendances > 0) {
    return { blocked: `Its application to ${eduApp.offering.title} has attendance recorded.` };
  }

  const effects: string[] = [];
  if (submission.staffingCycleId && submission.slot === "project-bids") {
    effects.push("Removes their project bids for this cycle.");
  }
  if (submission.staffingCycleId && submission.slot === "intent-to-work") {
    effects.push("Removes their intent to work for this cycle.");
  }
  if (partnerApp) effects.push(`Deletes the partner application "${partnerApp.title}".`);
  if (eduApp) effects.push(`Deletes their application to ${eduApp.offering.title}.`);
  if (submission.partnerSurveyFor) {
    effects.push("Lets the partner fill the post-project survey again.");
  }
  return { blocked: null, effects };
}
