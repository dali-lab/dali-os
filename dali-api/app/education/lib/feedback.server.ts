import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";
import { notify } from "~/lib/notify.server";
import { logAuditEvent } from "~/lib/audit";
import { sendEmail } from "~/lib/gmail";
import { getSenderRefreshToken } from "~/lib/gmail-integration";
import {
  resolveCandidateEmail,
  redirectBannerHtml,
} from "~/lib/candidate-email";
import { bodyToHtml } from "~/lib/email";
import { getFrontendUrl } from "~/lib/app-env";
import { recipientEmail } from "./notifications.server";

// Session feedback + instructor exit surveys, built on the shared Forms
// system via EducationFormBinding (mirrors StaffingCycleFormBinding). Slots:
export const SESSION_FEEDBACK_SLOT = "session-feedback";
export const INSTRUCTOR_EXIT_SLOT = "instructor-exit";

export type EducationFillContext = {
  slot: string;
  offeringId: string;
  sessionId: string | null;
};

/**
 * Validate an education fill: the form must be bound to the offering the
 * context names, and the submitter must be authorized for the slot
 * (session-feedback → Approved enrollee; instructor-exit → offering
 * instructor). Never trusts the client beyond the ids — everything is
 * re-derived here. Returns null when the context doesn't check out.
 */
export async function educationFillContext(args: {
  formId: string;
  userId: string;
  sessionId?: string | null;
  offeringId?: string | null;
}): Promise<EducationFillContext | null> {
  if (args.sessionId) {
    const session = await prisma.educationSession.findUnique({
      where: { id: args.sessionId },
      select: { id: true, offeringId: true },
    });
    if (!session) return null;
    const binding = await prisma.educationFormBinding.findUnique({
      where: {
        offeringId_slot: { offeringId: session.offeringId, slot: SESSION_FEEDBACK_SLOT },
      },
      select: { formId: true },
    });
    if (!binding || binding.formId !== args.formId) return null;
    const application = await prisma.educationApplication.findUnique({
      where: {
        applicantUserId_offeringId: {
          applicantUserId: args.userId,
          offeringId: session.offeringId,
        },
      },
      select: { status: true },
    });
    if (application?.status !== "Approved") return null;
    return {
      slot: SESSION_FEEDBACK_SLOT,
      offeringId: session.offeringId,
      sessionId: session.id,
    };
  }

  if (args.offeringId) {
    const binding = await prisma.educationFormBinding.findUnique({
      where: {
        offeringId_slot: { offeringId: args.offeringId, slot: INSTRUCTOR_EXIT_SLOT },
      },
      select: { formId: true },
    });
    if (!binding || binding.formId !== args.formId) return null;
    const instructor = await prisma.instructorAssignment.findFirst({
      where: { userId: args.userId, offeringId: args.offeringId },
      select: { id: true },
    });
    if (!instructor) return null;
    return { slot: INSTRUCTOR_EXIT_SLOT, offeringId: args.offeringId, sessionId: null };
  }

  return null;
}

/**
 * Loader-side gate for non-members opening /forms/fill/:token with education
 * context. True when the context would validate for this user.
 */
export async function canFillEducationForm(args: {
  token: string;
  userId: string;
  sessionId?: string | null;
  offeringId?: string | null;
}): Promise<boolean> {
  const form = await prisma.form.findUnique({
    where: { publicToken: args.token },
    select: { id: true },
  });
  if (!form) return false;
  const context = await educationFillContext({
    formId: form.id,
    userId: args.userId,
    sessionId: args.sessionId,
    offeringId: args.offeringId,
  });
  return context !== null;
}

/**
 * Close only the todo that pointed at THIS session/offering fill. A single
 * feedback form is bound across N sessions, so the generic formId-wide
 * closeFormTodos would wipe every pending session todo on one submit.
 */
export async function closeEducationFormTodos(
  tx: Pick<Prisma.TransactionClient, "notification">,
  args: { userId: string; formId: string; linkQuery: string },
): Promise<void> {
  await tx.notification.updateMany({
    where: {
      recipientUserId: args.userId,
      isTodo: true,
      readAt: null,
      formId: args.formId,
      link: { contains: args.linkQuery },
    },
    data: { readAt: new Date() },
  });
}

async function boundPublishedForm(offeringId: string, slot: string) {
  const binding = await prisma.educationFormBinding.findUnique({
    where: { offeringId_slot: { offeringId, slot } },
    select: {
      form: { select: { id: true, name: true, published: true, publicToken: true } },
    },
  });
  const form = binding?.form;
  if (!form?.published || !form.publicToken) return null;
  return form;
}

/**
 * Ask everyone marked Present at a session for feedback. Called after each
 * attendance save; deduped per (user, form, session link) so later-marked
 * attendees still get asked without double-notifying earlier ones. Members
 * get an in-app form todo; portal students get the link by email.
 */
export async function requestSessionFeedback(args: {
  offeringId: string;
  sessionId: string;
  presentUserIds: string[];
}): Promise<void> {
  if (args.presentUserIds.length === 0) return;
  const form = await boundPublishedForm(args.offeringId, SESSION_FEEDBACK_SLOT);
  if (!form) return;

  const [offering, session, users] = await Promise.all([
    prisma.educationOffering.findUnique({
      where: { id: args.offeringId },
      select: { title: true },
    }),
    prisma.educationSession.findUnique({
      where: { id: args.sessionId },
      select: { sequence: true, feedbackRequestedAt: true },
    }),
    prisma.user.findMany({
      where: { id: { in: args.presentUserIds } },
      select: {
        id: true,
        firstName: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        netId: true,
      },
    }),
  ]);
  if (!offering || !session) return;

  const linkQuery = `?session=${args.sessionId}`;
  const link = `/forms/fill/${form.publicToken}${linkQuery}`;
  const title = `Session feedback — ${offering.title}, session ${session.sequence}`;

  for (const user of users) {
    try {
      // Skip anyone already asked for this session (or who already submitted —
      // their todo is closed but a submission row exists).
      const [existingTodo, existingSubmission] = await Promise.all([
        prisma.notification.findFirst({
          where: {
            recipientUserId: user.id,
            formId: form.id,
            link: { contains: linkQuery },
          },
          select: { id: true },
        }),
        prisma.formSubmission.findFirst({
          where: {
            formId: form.id,
            userId: user.id,
            educationSessionId: args.sessionId,
          },
          select: { id: true },
        }),
      ]);
      if (existingTodo || existingSubmission) continue;

      if (user.daliEmail) {
        await notify({
          eventType: "education.feedback_request",
          message: {
            isTodo: true,
            formId: form.id,
            title,
            body: "Two minutes of feedback helps the instructors improve the next session.",
            link,
          },
          recipients: [{ userId: user.id }],
        });
      } else {
        // Portal students don't see the member notification bell — email the
        // fill link directly.
        const refreshToken = await getSenderRefreshToken("Education");
        if (refreshToken) {
          const { to, redirectedFrom } = resolveCandidateEmail(recipientEmail(user));
          if (to) {
            await sendEmail({
              refreshToken,
              to,
              subject: title,
              html:
                redirectBannerHtml(redirectedFrom) +
                bodyToHtml(
                  `Hi ${user.firstName},\n\nThanks for coming to ${offering.title}! Could you take two minutes to share feedback on session ${session.sequence}?\n\n${getFrontendUrl()}${link}\n\n— DALI Education`,
                ),
            });
          }
        }
      }
    } catch (err) {
      console.error("session feedback request failed", {
        userId: user.id,
        sessionId: args.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!session.feedbackRequestedAt) {
    await prisma.educationSession.update({
      where: { id: args.sessionId },
      data: { feedbackRequestedAt: new Date() },
    });
  }
}

/** Exit-survey todos for every instructor, fired from course close-out. */
export async function requestInstructorExitSurveys(offeringId: string): Promise<void> {
  const form = await boundPublishedForm(offeringId, INSTRUCTOR_EXIT_SLOT);
  if (!form) return;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: { title: true, instructors: { select: { userId: true } } },
  });
  if (!offering) return;

  const linkQuery = `?offering=${offeringId}`;
  for (const instructor of offering.instructors) {
    try {
      const existing = await prisma.notification.findFirst({
        where: {
          recipientUserId: instructor.userId,
          formId: form.id,
          link: { contains: linkQuery },
        },
        select: { id: true },
      });
      if (existing) continue;
      await notify({
        eventType: "education.feedback_request",
        message: {
          isTodo: true,
          formId: form.id,
          title: `Instructor exit survey — ${offering.title}`,
          body: "The course is closed out — tell the education team how it went.",
          link: `/forms/fill/${form.publicToken}${linkQuery}`,
        },
        recipients: [{ userId: instructor.userId }],
      });
    } catch (err) {
      console.error("exit survey request failed", {
        userId: instructor.userId,
        offeringId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Stable order keyed by submission id so results can't be correlated with
 *  roster order; simple string hash, no randomness (deterministic renders). */
function anonymousOrder(a: { id: string }, b: { id: string }): number {
  const h = (s: string) => {
    let x = 0;
    for (let i = 0; i < s.length; i += 1) x = (x * 31 + s.charCodeAt(i)) | 0;
    return x;
  };
  return h(a.id) - h(b.id);
}

/**
 * Feedback results for the manage tab. Instructors see anonymized rows in a
 * stable shuffled order; Core (moderation escape hatch) may include
 * identities via `includeIdentities`.
 */
export async function listFeedbackResults(args: {
  offeringId: string;
  slot: string;
  sessionId?: string | null;
  includeIdentities: boolean;
}) {
  const binding = await prisma.educationFormBinding.findUnique({
    where: { offeringId_slot: { offeringId: args.offeringId, slot: args.slot } },
    select: {
      form: {
        select: {
          id: true,
          name: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { questions: true },
          },
        },
      },
    },
  });
  if (!binding) return null;

  const submissions = await prisma.formSubmission.findMany({
    where: {
      formId: binding.form.id,
      slot: args.slot,
      educationOfferingId: args.offeringId,
      ...(args.sessionId ? { educationSessionId: args.sessionId } : {}),
    },
    select: {
      id: true,
      answers: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });

  // Response rate: who was asked vs who answered. Session feedback goes to
  // attendees marked Present; the instructor exit survey goes to instructors.
  let eligible = 0;
  if (args.slot === SESSION_FEEDBACK_SLOT && args.sessionId) {
    eligible = await prisma.educationAttendance.count({
      where: { sessionId: args.sessionId, status: "Present" },
    });
  } else if (args.slot === INSTRUCTOR_EXIT_SLOT) {
    eligible = await prisma.instructorAssignment.count({
      where: { offeringId: args.offeringId },
    });
  }

  return {
    formName: binding.form.name,
    responded: submissions.length,
    eligible,
    questions: (binding.form.versions[0]?.questions as unknown as
      | { key: string; type: string; data: { label: string } }[]
      | undefined) ?? [],
    submissions: submissions.sort(anonymousOrder).map((s) => ({
      id: s.id,
      answers: (s.answers as Record<string, unknown>) ?? {},
      submitterName:
        args.includeIdentities && s.user
          ? `${s.user.firstName} ${s.user.lastName}`.trim()
          : null,
    })),
  };
}

/** Bind/unbind a form to a feedback slot (manager-gated at the route). */
export async function setFormBinding(args: {
  offeringId: string;
  slot: string;
  formId: string | null;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  if (args.slot !== SESSION_FEEDBACK_SLOT && args.slot !== INSTRUCTOR_EXIT_SLOT)
    return { error: "Unknown feedback slot", status: 400 };
  if (!args.formId) {
    await prisma.educationFormBinding.deleteMany({
      where: { offeringId: args.offeringId, slot: args.slot },
    });
  } else {
    const form = await prisma.form.findUnique({
      where: { id: args.formId },
      select: { id: true, published: true, publicToken: true },
    });
    if (!form) return { error: "Form not found", status: 404 };
    if (!form.published || !form.publicToken)
      return {
        error: "Publish the form first — feedback links use its public token",
        status: 400,
      };
    await prisma.educationFormBinding.upsert({
      where: {
        offeringId_slot: { offeringId: args.offeringId, slot: args.slot },
      },
      create: {
        offeringId: args.offeringId,
        slot: args.slot,
        formId: args.formId,
        updatedById: args.actorId,
      },
      update: { formId: args.formId, updatedById: args.actorId },
    });
  }
  await logAuditEvent({
    action: "education.form-binding.set",
    userId: args.actorId,
    targetId: args.offeringId,
    metadata: { slot: args.slot, formId: args.formId },
  });
  return { ok: true };
}
