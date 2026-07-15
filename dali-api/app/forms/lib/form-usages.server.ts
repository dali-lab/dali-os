import { prisma } from "~/lib/db";
import { SLOTS, isSlot } from "~/projects/lib/form-slots";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";

// Central answer to "where is this form used?". Each surface keeps its own
// binding (StaffingCycleFormBinding, PartnerApplicationFormBinding,
// Notification.formId, the onboarding profile form's reserved name); this
// registry unions them so the forms admin can show usage and refuse
// destructive actions instead of silently breaking a live surface.

export type FormUsage = {
  kind:
    | "staffing"
    | "partner-application"
    | "notification"
    | "onboarding-profile";
  label: string;
};

export async function formUsages(formId: string): Promise<FormUsage[]> {
  const [form, staffingBindings, partnerBinding, attachedCount, openTodoCount] =
    await Promise.all([
      prisma.form.findUnique({
        where: { id: formId },
        select: { name: true },
      }),
      prisma.staffingCycleFormBinding.findMany({
        where: { formId },
        select: {
          slot: true,
          staffingCycle: { select: { term: { select: { code: true } } } },
        },
      }),
      prisma.partnerApplicationFormBinding.findFirst({
        where: { formId },
        select: { id: true },
      }),
      prisma.notification.count({ where: { formId } }),
      prisma.notification.count({
        where: { formId, isTodo: true, readAt: null },
      }),
    ]);

  const usages: FormUsage[] = [];
  for (const b of staffingBindings) {
    const slotName = isSlot(b.slot) ? SLOTS[b.slot] : b.slot;
    usages.push({
      kind: "staffing",
      label: `${b.staffingCycle.term.code} ${slotName}`,
    });
  }
  if (partnerBinding) {
    usages.push({
      kind: "partner-application",
      label: "Partner application (/partner/apply)",
    });
  }
  if (form?.name === NEW_MEMBER_PROFILE_FORM_NAME) {
    usages.push({
      kind: "onboarding-profile",
      label: "New-member onboarding profile",
    });
  }
  if (attachedCount > 0) {
    const todos =
      openTodoCount > 0
        ? ` (${openTodoCount} open to-do${openTodoCount === 1 ? "" : "s"})`
        : "";
    usages.push({
      kind: "notification",
      label: `Attached to ${attachedCount} announcement${attachedCount === 1 ? "" : "s"}${todos}`,
    });
  }
  return usages;
}

// Reasons deleting this form would break something beyond the form itself.
// Deleting a Form cascades its FormSubmissions away, so submissions another
// surface depends on block deletion: staffing-board rows and partner
// applications' answers (the application row survives via SetNull, but its
// answers would be gone). Read announcement attachments don't block — only
// open to-dos, which would become unclearable (closeFormTodos matches on
// formId, which deletion nulls out).
export async function formDeletionBlockers(formId: string): Promise<string[]> {
  const [usages, partnerAnswerCount, staffingSubmissionCount, openTodoCount] =
    await Promise.all([
      formUsages(formId),
      prisma.partnerApplication.count({
        where: { formSubmission: { formId } },
      }),
      prisma.formSubmission.count({
        where: { formId, staffingCycleId: { not: null } },
      }),
      prisma.notification.count({
        where: { formId, isTodo: true, readAt: null },
      }),
    ]);

  const blockers = usages
    .filter((u) => u.kind !== "notification")
    .map((u) => `bound to ${u.label}`);
  if (staffingSubmissionCount > 0) {
    blockers.push(
      `${staffingSubmissionCount} staffing submission${staffingSubmissionCount === 1 ? "" : "s"} would be deleted`,
    );
  }
  if (partnerAnswerCount > 0) {
    blockers.push(
      `${partnerAnswerCount} partner application${partnerAnswerCount === 1 ? "" : "s"} would lose their answers`,
    );
  }
  if (openTodoCount > 0) {
    blockers.push(
      `${openTodoCount} open announcement to-do${openTodoCount === 1 ? "" : "s"} point${openTodoCount === 1 ? "s" : ""} at it`,
    );
  }
  return blockers;
}
